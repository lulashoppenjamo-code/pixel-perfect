-- ============================================================
-- LULA OS — FASE 0: Completar RPCs + barcode
-- Ejecutar en Supabase SQL Editor o supabase db push
-- ============================================================

-- 1) Campo barcode en products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique
  ON public.products (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

-- 2) set_inventory_limits
CREATE OR REPLACE FUNCTION public.set_inventory_limits(
  _branch_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _min_stock numeric,
  _max_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \[ DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;

  INSERT INTO public.inventory (branch_id, product_id, variant_id, stock, min_stock, max_stock)
  VALUES (
    _branch_id,
    _product_id,
    _variant_id,
    0,
    COALESCE(_min_stock, 0),
    _max_stock
  )
  ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    min_stock = COALESCE(_min_stock, public.inventory.min_stock),
    max_stock = _max_stock,
    updated_at = now();
END; \];

REVOKE ALL ON FUNCTION public.set_inventory_limits(uuid, uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_limits(uuid, uuid, uuid, numeric, numeric) TO authenticated, service_role;

-- 3) receive_purchase_partial
CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb  -- [{ "item_id": uuid, "qty": number }]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \[ DECLARE
  uid uuid := auth.uid();
  p public.purchases;
  it jsonb;
  pi public.purchase_items;
  remaining numeric;
  to_receive numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;

  SELECT * INTO p FROM public.purchases WHERE id = _purchase_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'purchase not found'; END IF;
  IF p.status = 'cancelled' THEN RAISE EXCEPTION 'purchase cancelled'; END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO pi FROM public.purchase_items WHERE id = (it->>'item_id')::uuid AND purchase_id = _purchase_id;
    IF pi.id IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;

    remaining := pi.quantity - COALESCE(pi.received_qty, 0);
    to_receive := LEAST(remaining, GREATEST((it->>'qty')::numeric, 0));
    IF to_receive <= 0 THEN CONTINUE; END IF;

    UPDATE public.purchase_items
    SET received_qty = COALESCE(received_qty, 0) + to_receive
    WHERE id = pi.id;

    -- Aumentar stock
    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (p.branch_id, pi.product_id, pi.variant_id, to_receive)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock + to_receive, updated_at = now();

    INSERT INTO public.inventory_movements (
      branch_id, product_id, variant_id, type, quantity,
      reference_id, reference_type, notes, created_by
    ) VALUES (
      p.branch_id, pi.product_id, pi.variant_id, 'purchase', to_receive,
      p.id, 'purchase', 'Recepción parcial', uid
    );
  END LOOP;

  -- Si todo recibido → marcar received
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_items
    WHERE purchase_id = _purchase_id
      AND COALESCE(received_qty, 0) < quantity
  ) THEN
    UPDATE public.purchases SET status = 'received', updated_at = now() WHERE id = _purchase_id;
  ELSIF p.status = 'draft' OR p.status = 'ordered' THEN
    UPDATE public.purchases SET status = 'ordered', updated_at = now() WHERE id = _purchase_id;
  END IF;
END; \];

REVOKE ALL ON FUNCTION public.receive_purchase_partial(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_partial(uuid, jsonb) TO authenticated, service_role;

-- Asegurar columna received_qty si no existe
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS received_qty numeric(12,2) NOT NULL DEFAULT 0;

-- 4) refund_sale (devolución / reembolso parcial o total)
CREATE OR REPLACE FUNCTION public.refund_sale(
  _sale_id uuid,
  _items jsonb,           -- [{ "sale_item_id": uuid, "quantity": number }]
  _reason text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \[ DECLARE
  uid uuid := auth.uid();
  s public.sales;
  it jsonb;
  si public.sale_items;
  qty numeric;
  refund_subtotal numeric(12,2) := 0;
  refund_tax numeric(12,2) := 0;
  new_status public.sale_status;
  total_qty numeric;
  refunded_qty numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO s FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'sale already cancelled'; END IF;
  IF s.status = 'refunded' THEN RAISE EXCEPTION 'sale already fully refunded'; END IF;

  -- Solo manager o el cajero de la venta
  IF s.cashier_id <> uid AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO si FROM public.sale_items WHERE id = (it->>'sale_item_id')::uuid AND sale_id = _sale_id;
    IF si.id IS NULL THEN RAISE EXCEPTION 'sale item not found'; END IF;

    qty := (it->>'quantity')::numeric;
    IF qty <= 0 OR qty > si.quantity THEN
      RAISE EXCEPTION 'invalid quantity for item %', si.id;
    END IF;

    -- Devolver stock
    INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
    VALUES (s.branch_id, si.product_id, si.variant_id, qty)
    ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET stock = public.inventory.stock + qty, updated_at = now();

    INSERT INTO public.inventory_movements (
      branch_id, product_id, variant_id, type, quantity,
      reference_id, reference_type, notes, created_by
    ) VALUES (
      s.branch_id, si.product_id, si.variant_id, 'return', qty,
      s.id, 'sale', COALESCE(_reason, 'Devolución'), uid
    );

    refund_subtotal := refund_subtotal + ((si.unit_price * qty) - COALESCE(si.discount, 0) * (qty / NULLIF(si.quantity, 0)));
  END LOOP;

  -- Recalcular estado
  SELECT COALESCE(SUM(quantity), 0) INTO total_qty FROM public.sale_items WHERE sale_id = _sale_id;

  -- Simplificación: si se devolvió todo → refunded, si no → partially_refunded
  -- (en una versión más avanzada se trackea cantidad ya reembolsada por ítem)
  new_status := 'partially_refunded';
  IF refund_subtotal >= (s.subtotal - 0.01) THEN
    new_status := 'refunded';
  END IF;

  UPDATE public.sales
  SET status = new_status, updated_at = now()
  WHERE id = _sale_id
  RETURNING * INTO s;

  RETURN s;
END; \];

REVOKE ALL ON FUNCTION public.refund_sale(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_sale(uuid, jsonb, text) TO authenticated, service_role;

-- 5) Transferencia atómica entre sucursales
CREATE OR REPLACE FUNCTION public.transfer_stock(
  _from_branch uuid,
  _to_branch uuid,
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \[ DECLARE
  uid uuid := auth.uid();
  current_stock numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _from_branch = _to_branch THEN RAISE EXCEPTION 'same branch'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;

  SELECT stock INTO current_stock
  FROM public.inventory
  WHERE branch_id = _from_branch
    AND product_id = _product_id
    AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        COALESCE(_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  FOR UPDATE;

  IF current_stock IS NULL OR current_stock < _quantity THEN
    RAISE EXCEPTION 'insufficient stock';
  END IF;

  -- Salida
  UPDATE public.inventory
  SET stock = stock - _quantity, updated_at = now()
  WHERE branch_id = _from_branch
    AND product_id = _product_id
    AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        COALESCE(_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

  INSERT INTO public.inventory_movements (
    branch_id, product_id, variant_id, type, quantity, notes, created_by
  ) VALUES (
    _from_branch, _product_id, _variant_id, 'transfer_out', -_quantity, _notes, uid
  );

  -- Entrada
  INSERT INTO public.inventory (branch_id, product_id, variant_id, stock)
  VALUES (_to_branch, _product_id, _variant_id, _quantity)
  ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET stock = public.inventory.stock + _quantity, updated_at = now();

  INSERT INTO public.inventory_movements (
    branch_id, product_id, variant_id, type, quantity, notes, created_by
  ) VALUES (
    _to_branch, _product_id, _variant_id, 'transfer_in', _quantity, _notes, uid
  );
END; \];

REVOKE ALL ON FUNCTION public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) TO authenticated, service_role;