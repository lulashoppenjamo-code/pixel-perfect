CREATE OR REPLACE FUNCTION public.create_sale(
  _branch_id uuid,
  _items jsonb,
  _payment_method public.payment_method DEFAULT 'cash',
  _customer_id uuid DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL,
  _discount numeric DEFAULT 0,
  _cash_received numeric DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  it jsonb;
  v_subtotal numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_sale public.sales;
  v_line numeric(12,2);
  v_rate numeric(5,4);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'empty cart'; END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_line := (it->>'unit_price')::numeric * (it->>'quantity')::numeric - COALESCE((it->>'discount')::numeric, 0);
    SELECT COALESCE(p.tax_rate, 0) INTO v_rate FROM public.products p WHERE p.id = (it->>'product_id')::uuid;
    v_subtotal := v_subtotal + v_line;
    v_tax := v_tax + ROUND(v_line * COALESCE(v_rate, 0), 2);
  END LOOP;

  v_total := v_subtotal + v_tax - COALESCE(_discount, 0);

  INSERT INTO public.sales (branch_id, cashier_id, customer_id, cash_session_id, subtotal, tax, discount, total,
                            payment_method, cash_received, change_given, status)
  VALUES (_branch_id, uid, _customer_id, _cash_session_id, v_subtotal, v_tax, COALESCE(_discount,0), v_total,
          _payment_method, _cash_received,
          CASE WHEN _cash_received IS NULL THEN NULL ELSE GREATEST(_cash_received - v_total, 0) END,
          'completed')
  RETURNING * INTO v_sale;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_line := (it->>'unit_price')::numeric * (it->>'quantity')::numeric - COALESCE((it->>'discount')::numeric, 0);

    INSERT INTO public.sale_items (sale_id, product_id, variant_id, name_snapshot, unit_price, quantity, discount, total)
    VALUES (v_sale.id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, it->>'name',
            (it->>'unit_price')::numeric, (it->>'quantity')::numeric, COALESCE((it->>'discount')::numeric,0), v_line);

    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (_branch_id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, -(it->>'quantity')::numeric)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock - (it->>'quantity')::numeric, updated_at = now();

    INSERT INTO public.inventory_movements (branch_id, product_id, variant_id, type, quantity, reference_id, reference_type, created_by)
    VALUES (_branch_id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, 'sale',
            -(it->>'quantity')::numeric, v_sale.id, 'sale', uid);
  END LOOP;

  RETURN v_sale;
END; $$;

REVOKE ALL ON FUNCTION public.create_sale(uuid, jsonb, public.payment_method, uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, jsonb, public.payment_method, uuid, uuid, numeric, numeric) TO authenticated, service_role;

-- Receive a purchase order: adds stock and logs movements
CREATE OR REPLACE FUNCTION public.receive_purchase(_purchase_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r record; v_branch uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT branch_id INTO v_branch FROM public.purchases WHERE id = _purchase_id AND status <> 'received';
  IF v_branch IS NULL THEN RAISE EXCEPTION 'purchase not found or already received'; END IF;

  FOR r IN SELECT * FROM public.purchase_items WHERE purchase_id = _purchase_id LOOP
    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (v_branch, r.product_id, r.variant_id, r.quantity)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock + r.quantity, updated_at = now();

    INSERT INTO public.inventory_movements (branch_id, product_id, variant_id, type, quantity, reference_id, reference_type, created_by)
    VALUES (v_branch, r.product_id, r.variant_id, 'purchase', r.quantity, _purchase_id, 'purchase', uid);
  END LOOP;

  UPDATE public.purchases SET status = 'received', received_at = now() WHERE id = _purchase_id;
END; $$;

REVOKE ALL ON FUNCTION public.receive_purchase(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase(uuid) TO authenticated, service_role;

-- Manual stock adjustment (managers)
CREATE OR REPLACE FUNCTION public.adjust_stock(_branch_id uuid, _product_id uuid, _variant_id uuid, _quantity numeric, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;

  INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
  VALUES (_branch_id, _product_id, _variant_id, _quantity)
  ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET stock = public.inventory.stock + _quantity, updated_at = now();

  INSERT INTO public.inventory_movements (branch_id, product_id, variant_id, type, quantity, notes, created_by)
  VALUES (_branch_id, _product_id, _variant_id,
          CASE WHEN _quantity >= 0 THEN 'adjustment_in'::public.movement_type ELSE 'adjustment_out'::public.movement_type END,
          _quantity, _notes, uid);
END; $$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, uuid, numeric, text) TO authenticated, service_role;

-- Close a cash session with expected amount computed from sales + movements
CREATE OR REPLACE FUNCTION public.close_cash_session(_session_id uuid, _closing_amount numeric)
RETURNS public.cash_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); s public.cash_sessions; v_expected numeric(12,2);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO s FROM public.cash_sessions WHERE id = _session_id AND status = 'open';
  IF s.id IS NULL THEN RAISE EXCEPTION 'session not found or closed'; END IF;
  IF s.opened_by <> uid AND NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;

  SELECT s.opening_amount
       + COALESCE((SELECT SUM(total) FROM public.sales WHERE cash_session_id = s.id AND payment_method = 'cash' AND status = 'completed'), 0)
       + COALESCE((SELECT SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END) FROM public.cash_movements WHERE cash_session_id = s.id), 0)
  INTO v_expected;

  UPDATE public.cash_sessions
  SET status = 'closed', closed_by = uid, closed_at = now(),
      closing_amount = _closing_amount, expected_amount = v_expected,
      difference = _closing_amount - v_expected
  WHERE id = _session_id RETURNING * INTO s;
  RETURN s;
END; $$;

REVOKE ALL ON FUNCTION public.close_cash_session(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric) TO authenticated, service_role;