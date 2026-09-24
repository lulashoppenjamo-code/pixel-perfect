-- ============================================================
-- LULA OS — CORRECCIÓN REPORTES INVENTARIO
-- product_variants no tiene barcode; usa el barcode del producto.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_reports_inventory()
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  product_name text,
  sku text,
  barcode text,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric,
  min_stock numeric,
  max_stock numeric,
  unit_cost numeric,
  unit_price numeric,
  inventory_cost numeric,
  inventory_retail numeric,
  stock_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT
    si.product_id,
    si.variant_id,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN COALESCE(pv.name, p.name)
      ELSE p.name
    END::text AS product_name,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN COALESCE(pv.sku, p.sku)
      ELSE p.sku
    END::text AS sku,

    p.barcode::text AS barcode,

    COALESCE(si.stock, 0) AS stock,
    COALESCE(si.reserved_stock, 0) AS reserved_stock,

    GREATEST(
      COALESCE(si.stock, 0) - COALESCE(si.reserved_stock, 0),
      0
    ) AS available_stock,

    COALESCE(si.min_stock, 0) AS min_stock,
    si.max_stock,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN COALESCE(pv.cost_override, p.cost, 0)
      ELSE COALESCE(p.cost, 0)
    END AS unit_cost,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN COALESCE(pv.price_override, p.price, 0)
      ELSE COALESCE(p.price, 0)
    END AS unit_price,

    ROUND(
      COALESCE(si.stock, 0) *
      CASE
        WHEN si.variant_id IS NOT NULL
        THEN COALESCE(pv.cost_override, p.cost, 0)
        ELSE COALESCE(p.cost, 0)
      END,
      2
    ) AS inventory_cost,

    ROUND(
      COALESCE(si.stock, 0) *
      CASE
        WHEN si.variant_id IS NOT NULL
        THEN COALESCE(pv.price_override, p.price, 0)
        ELSE COALESCE(p.price, 0)
      END,
      2
    ) AS inventory_retail,

    CASE
      WHEN GREATEST(
        COALESCE(si.stock, 0) - COALESCE(si.reserved_stock, 0),
        0
      ) <= 0
      THEN 'out_of_stock'

      WHEN GREATEST(
        COALESCE(si.stock, 0) - COALESCE(si.reserved_stock, 0),
        0
      ) <= COALESCE(si.min_stock, 0)
      THEN 'low_stock'

      ELSE 'ok'
    END AS stock_status

  FROM public.shared_inventory si

  INNER JOIN public.products p
    ON p.id = si.product_id

  LEFT JOIN public.product_variants pv
    ON pv.id = si.variant_id

  WHERE p.is_active = true

  ORDER BY
    available_stock ASC,
    product_name ASC;

$$;

REVOKE ALL
ON FUNCTION public.get_reports_inventory()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_reports_inventory()
TO authenticated;

COMMENT ON FUNCTION public.get_reports_inventory()
IS
'LULA OS: inventario compartido ejecutivo con valores a costo, venta y alertas de stock.';

COMMIT;