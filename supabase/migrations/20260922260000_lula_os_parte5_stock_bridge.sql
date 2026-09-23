BEGIN;

-- ============================================================
-- LULA OS — PARTE 5
-- PUENTE DE LECTURA DEL INVENTARIO CENTRAL
--
-- shared_inventory = fuente única de existencia.
-- inventory = histórico/compatibilidad.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_inventory()
RETURNS TABLE (
  id uuid,
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
SET search_path TO public
AS $$
  SELECT
    si.id,
    si.product_id,
    si.variant_id,

    p.name,
    p.sku,
    p.barcode,
    p.price,
    p.cost,
    p.image_url,
    p.emoji,
    p.is_active,

    si.stock,
    si.reserved_stock,

    GREATEST(
      si.stock - si.reserved_stock,
      0
    ) AS available_stock,

    si.min_stock,
    si.max_stock,

    CASE
      WHEN GREATEST(
        si.stock - si.reserved_stock,
        0
      ) <= 0
        THEN 'out_of_stock'

      WHEN si.min_stock > 0
        AND GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
        THEN 'low_stock'

      ELSE 'ok'
    END AS stock_status

  FROM public.shared_inventory si

  INNER JOIN public.products p
    ON p.id = si.product_id

  WHERE p.is_active = true

  ORDER BY p.name;
$$;

GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated;


-- ============================================================
-- STOCK DE UN PRODUCTO/VARIANTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_product_stock(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS TABLE (
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
SET search_path TO public
AS $$
  SELECT
    si.stock,
    si.reserved_stock,

    GREATEST(
      si.stock - si.reserved_stock,
      0
    ) AS available_stock,

    si.min_stock,
    si.max_stock,

    CASE
      WHEN GREATEST(
        si.stock - si.reserved_stock,
        0
      ) <= 0
        THEN 'out_of_stock'

      WHEN si.min_stock > 0
        AND GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
        THEN 'low_stock'

      ELSE 'ok'
    END AS stock_status

  FROM public.shared_inventory si

  WHERE si.product_id = _product_id

    AND si.variant_id
      IS NOT DISTINCT FROM _variant_id

  LIMIT 1;
$$;

GRANT EXECUTE
ON FUNCTION public.get_shared_product_stock(uuid,uuid)
TO authenticated;


COMMENT ON FUNCTION public.get_shared_inventory() IS
'LULA OS: lectura oficial del inventario central compartido.';

COMMENT ON FUNCTION public.get_shared_product_stock(uuid,uuid) IS
'LULA OS: consulta de existencia central de un producto o variante.';

COMMIT;