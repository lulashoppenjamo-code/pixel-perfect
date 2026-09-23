ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS cost_total numeric
  GENERATED ALWAYS AS (ROUND(unit_cost * quantity, 2)) STORED;

CREATE OR REPLACE FUNCTION public.cancel_sale(_sale_id uuid, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'La venta ya está cancelada';
  END IF;

  IF v_sale.cashier_id <> auth.uid() AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'No tienes permiso para cancelar esta venta';
  END IF;

  FOR v_item IN
    SELECT product_id, variant_id, quantity FROM public.sale_items WHERE sale_id = _sale_id
  LOOP
    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (v_sale.branch_id, v_item.product_id, v_item.variant_id, v_item.quantity)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock + v_item.quantity, updated_at = now();

    INSERT INTO public.inventory_movements
      (branch_id, product_id, variant_id, type, quantity, reference_id, reference_type, notes, created_by)
    VALUES
      (v_sale.branch_id, v_item.product_id, v_item.variant_id, 'return', v_item.quantity,
       _sale_id, 'sale_cancel', COALESCE(_reason, 'Cancelación de venta'), auth.uid());
  END LOOP;

  UPDATE public.sales
     SET status = 'cancelled',
         notes = COALESCE(notes || ' | ', '') || COALESCE(_reason, 'Cancelada'),
         updated_at = now()
   WHERE id = _sale_id;

  RETURN _sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_shared_inventory_limits(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _min_stock numeric DEFAULT 0,
  _max_stock numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Solo encargados o administradores pueden fijar límites';
  END IF;

  UPDATE public.inventory
     SET min_stock = COALESCE(_min_stock, 0),
         max_stock = _max_stock,
         updated_at = now()
   WHERE product_id = _product_id
     AND (_variant_id IS NULL OR variant_id = _variant_id);

  IF NOT FOUND THEN
    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock, min_stock, max_stock)
    SELECT b.id, _product_id, _variant_id, 0, COALESCE(_min_stock, 0), _max_stock
    FROM public.branches b
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_sale(
  _branch_id uuid,
  _items jsonb,
  _payment_method public.payment_method DEFAULT 'cash',
  _customer_id uuid DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL,
  _discount numeric DEFAULT 0,
  _cash_received numeric DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  it jsonb;
  v_subtotal numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_sale public.sales;
  v_line numeric(12,2);
  v_rate numeric(5,4);
  v_cost numeric(12,2);
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

    SELECT COALESCE(p.cost, 0) INTO v_cost FROM public.products p WHERE p.id = (it->>'product_id')::uuid;

    INSERT INTO public.sale_items (sale_id, product_id, variant_id, name_snapshot, unit_price, quantity, discount, total, unit_cost)
    VALUES (v_sale.id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, it->>'name',
            (it->>'unit_price')::numeric, (it->>'quantity')::numeric, COALESCE((it->>'discount')::numeric,0), v_line,
            COALESCE(v_cost, 0));

    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (_branch_id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, -(it->>'quantity')::numeric)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock - (it->>'quantity')::numeric, updated_at = now();

    INSERT INTO public.inventory_movements (branch_id, product_id, variant_id, type, quantity, reference_id, reference_type, created_by)
    VALUES (_branch_id, (it->>'product_id')::uuid, NULLIF(it->>'variant_id','')::uuid, 'sale',
            -(it->>'quantity')::numeric, v_sale.id, 'sale', uid);
  END LOOP;

  RETURN v_sale;
END;
$$;