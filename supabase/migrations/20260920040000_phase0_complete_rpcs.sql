-- ============================================================
-- LULA OS — FASE 0: Completar RPCs + barcode
-- Ruta: supabase/migrations/20260920040000_phase0_complete_rpcs.sql
-- Ejecutar en Supabase SQL Editor o: supabase db push
-- ============================================================

-- 1) Campo barcode en products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique
  ON public.products (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

-- 2) received_qty en purchase_items (si no existe)
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS received_qty numeric(12,2) NOT NULL DEFAULT 0;

-- 3) set_inventory_limits
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
AS $$
DECLARE
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
END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_limits(uuid, uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_inventory_limits(uuid, uuid, uuid, numeric, numeric) TO authenticated, service_role;

-- 4) receive_purchase_partial
CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb  -- [{ "item_id": uuid, "qty": number }]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_items
    WHERE purchase_id = _purchase_id
      AND COALESCE(received_qty, 0) < quantity
  ) THEN
    UPDATE public.purchases SET status = 'received', updated_at = now() WHERE id = _purchase_id;
  ELSIF p.status = 'draft' OR p.status = 'ordered' THEN
    UPDATE publi
... 