-- ============================================================
-- LULA OS
-- SEGURIDAD FINAL — REPOSICIÓN
-- VALIDACIÓN DE CANTIDADES
-- 2026-09-25
--
-- OBJETIVO:
--   - Impedir cantidades 0 o negativas.
--   - Mantener reposición completamente separada
--     del inventario real.
--   - No modificar shared_inventory.
--   - No modificar compras.
--   - No modificar ventas.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. VALIDAR DATOS EXISTENTES
-- ============================================================

UPDATE public.replenishment_requests
SET quantity = 1
WHERE quantity IS NULL
   OR quantity <= 0;


-- ============================================================
-- 2. REEMPLAZAR CONSTRAINT
-- ============================================================

ALTER TABLE public.replenishment_requests
DROP CONSTRAINT IF EXISTS
replenishment_requests_quantity_positive;


ALTER TABLE public.replenishment_requests
ADD CONSTRAINT
replenishment_requests_quantity_positive
CHECK (
  quantity > 0
);


-- ============================================================
-- 3. VALIDAR PRODUCTO / VARIANTE
--
-- Si existe una variante, debe pertenecer al producto
-- seleccionado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_replenishment_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  IF NEW.product_id IS NULL THEN
    RAISE EXCEPTION
      'product is required';
  END IF;


  IF NEW.quantity IS NULL
     OR NEW.quantity <= 0
  THEN
    RAISE EXCEPTION
      'replenishment quantity must be greater than zero';
  END IF;


  IF NEW.variant_id IS NOT NULL THEN

    IF NOT EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.id = NEW.variant_id
        AND pv.product_id = NEW.product_id
    )
    THEN
      RAISE EXCEPTION
        'variant does not belong to selected product';
    END IF;

  END IF;


  IF NEW.branch_id IS NOT NULL THEN

    IF NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = NEW.branch_id
        AND b.is_active = true
    )
    THEN
      RAISE EXCEPTION
        'branch not found or inactive';
    END IF;

  END IF;


  RETURN NEW;

END;
$$;


-- ============================================================
-- 4. TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS
replenishment_requests_validate
ON public.replenishment_requests;


CREATE TRIGGER
replenishment_requests_validate
BEFORE INSERT OR UPDATE
ON public.replenishment_requests
FOR EACH ROW
EXECUTE FUNCTION
public.validate_replenishment_variant();


-- ============================================================
-- 5. SEGURIDAD DE LA FUNCIÓN
-- ============================================================

REVOKE ALL
ON FUNCTION public.validate_replenishment_variant()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.validate_replenishment_variant()
TO authenticated, service_role;


-- ============================================================
-- 6. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION
public.validate_replenishment_variant()
IS
'LULA OS: valida cantidades positivas, producto/variante compatibles y sucursal activa para solicitudes de reposición. No modifica inventario.';


COMMENT ON CONSTRAINT
replenishment_requests_quantity_positive
ON public.replenishment_requests
IS
'LULA OS: una solicitud de reposición siempre debe tener cantidad mayor que cero.';


COMMIT;