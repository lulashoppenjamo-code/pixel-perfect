ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

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
    ON CONFLICT (branch_id, product_id, variant_id)
    DO UPDATE SET stock = public.inventory.stock + EXCLUDED.stock, updated_at = now();

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

CREATE OR REPLACE FUNCTION public.get_shared_inventory()
RETURNS TABLE (
  id text,
  product_id uuid,
  variant_id uuid,
  product_name text,
  sku text,
  barcode text,
  price numeric,
  cost numeric,
  image_url text,
  emoji text,
  is_active boolean,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric,
  min_stock numeric,
  max_stock numeric,
  stock_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id::text || COALESCE(':' || i.variant_id::text, '') AS id,
    p.id AS product_id,
    i.variant_id,
    p.name AS product_name,
    p.sku,
    p.barcode,
    p.price,
    p.cost,
    p.image_url,
    p.emoji,
    p.is_active,
    COALESCE(SUM(i.stock), 0) AS stock,
    COALESCE(SUM(i.reserved_stock), 0) AS reserved_stock,
    GREATEST(COALESCE(SUM(i.stock), 0) - COALESCE(SUM(i.reserved_stock), 0), 0) AS available_stock,
    COALESCE(MAX(i.min_stock), 0) AS min_stock,
    MAX(i.max_stock) AS max_stock,
    CASE
      WHEN GREATEST(COALESCE(SUM(i.stock), 0) - COALESCE(SUM(i.reserved_stock), 0), 0) <= 0 THEN 'out_of_stock'
      WHEN GREATEST(COALESCE(SUM(i.stock), 0) - COALESCE(SUM(i.reserved_stock), 0), 0) <= COALESCE(MAX(i.min_stock), 0) THEN 'low_stock'
      ELSE 'ok'
    END AS stock_status
  FROM public.products p
  LEFT JOIN public.inventory i ON i.product_id = p.id
  WHERE auth.uid() IS NOT NULL
  GROUP BY p.id, i.variant_id, p.name, p.sku, p.barcode, p.price, p.cost, p.image_url, p.emoji, p.is_active
  ORDER BY p.name;
$$;

CREATE OR REPLACE FUNCTION public.get_shared_product_stock(_product_id uuid, _variant_id uuid DEFAULT NULL)
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _product_id AS product_id,
    _variant_id AS variant_id,
    COALESCE(SUM(i.stock), 0) AS stock,
    COALESCE(SUM(i.reserved_stock), 0) AS reserved_stock,
    GREATEST(COALESCE(SUM(i.stock), 0) - COALESCE(SUM(i.reserved_stock), 0), 0) AS available_stock
  FROM public.inventory i
  WHERE auth.uid() IS NOT NULL
    AND i.product_id = _product_id
    AND (_variant_id IS NULL OR i.variant_id = _variant_id);
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
    ON CONFLICT (branch_id, product_id, variant_id) DO NOTHING;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_sale(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_shared_inventory() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_shared_product_stock(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.set_shared_inventory_limits(uuid, uuid, numeric, numeric) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_inventory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_product_stock(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_shared_inventory_limits(uuid, uuid, numeric, numeric) TO authenticated, service_role;