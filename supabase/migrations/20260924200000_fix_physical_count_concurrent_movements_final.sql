-- ============================================================
-- LULA OS
-- INVENTARIO FÍSICO — CIERRE SEGURO CON MOVIMIENTOS CONCURRENTES
-- ============================================================
--
-- CORRECCIÓN:
--
-- La fotografía tomada al iniciar el conteo NO debe utilizarse
-- para modificar directamente el stock actual al cerrar.
--
-- Ejemplo:
--
-- Inicio del conteo:       10
-- Venta durante conteo:    -2
-- Stock actual:             8
-- Conteo físico:             8
--
-- Diferencia del conteo:
-- 8 - 10 = -2
--
-- Ajuste REAL necesario al cerrar:
-- 8 - 8 = 0
--
-- Por lo tanto el stock final continúa siendo 8.
--
-- La diferencia histórica del conteo sigue siendo -2.
--
-- Esto permite conservar tanto:
-- 1. la fotografía inicial;
-- 2. los movimientos posteriores;
-- 3. el conteo físico;
-- 4. el ajuste real aplicado.
--
-- NO modifica tablas.
-- NO elimina movimientos.
-- NO modifica POS.
-- NO modifica compras.
-- NO modifica ventas.
-- ============================================================

BEGIN;


-- ============================================================
-- REEMPLAZAR COMPLETE_INVENTORY_COUNT
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

  uid uuid := auth.uid();

  v_count public.inventory_counts;

  item record;

  v_current_stock numeric(12,2);

  v_adjustment numeric(12,2);

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- PERMISOS
  -- ==========================================================

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- BLOQUEAR EL CONTEO
  -- ==========================================================

  SELECT *
  INTO v_count

  FROM public.inventory_counts

  WHERE id = _count_id

  FOR UPDATE;


  IF v_count.id IS NULL THEN
    RAISE EXCEPTION
      'inventory count not found';
  END IF;


  IF v_count.status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not active';
  END IF;


  -- ==========================================================
  -- TODOS LOS PRODUCTOS DEBEN ESTAR CONTADOS
  -- ==========================================================

  IF EXISTS (
    SELECT 1

    FROM public.inventory_count_items

    WHERE count_id = _count_id

      AND counted_stock IS NULL
  )
  THEN

    RAISE EXCEPTION
      'inventory count has uncounted items';

  END IF;


  -- ==========================================================
  -- PROCESAR CADA PRODUCTO
  -- ==========================================================

  FOR item IN

    SELECT
      id,
      product_id,
      variant_id,
      system_stock,
      counted_stock,
      unit_cost

    FROM public.inventory_count_items

    WHERE count_id = _count_id

    ORDER BY product_id

  LOOP


    -- ========================================================
    -- OBTENER STOCK ACTUAL
    -- ========================================================
    --
    -- IMPORTANTE:
    --
    -- Este valor puede ser diferente de system_stock porque
    -- pudieron ocurrir ventas, devoluciones, compras o ajustes
    -- mientras el inventario físico estaba abierto.
    --
    -- FOR UPDATE evita que otra operación modifique esta fila
    -- mientras se realiza el ajuste.
    -- ========================================================

    SELECT stock

    INTO v_current_stock

    FROM public.shared_inventory

    WHERE product_id = item.product_id

      AND variant_id
        IS NOT DISTINCT FROM item.variant_id

    FOR UPDATE;


    -- ========================================================
    -- REGISTRO DE INVENTARIO NO EXISTENTE
    -- ========================================================

    IF NOT FOUND THEN

      -- Si el sistema no tenía registro, el stock actual es 0.
      v_current_stock := 0;


      -- El ajuste real es exactamente lo contado.
      v_adjustment :=
        item.counted_stock;


      IF item.counted_stock > 0 THEN

        INSERT INTO public.shared_inventory(
          product_id,
          variant_id,
          stock,
          reserved_stock,
          updated_at
        )
        VALUES(
          item.product_id,
          item.variant_id,
          item.counted_stock,
          0,
          now()
        );

      END IF;


    ELSE

      -- ======================================================
      -- AJUSTE REAL
      -- ======================================================
      --
      -- NO usamos:
      --
      -- counted_stock - system_stock
      --
      -- porque system_stock es la fotografía inicial.
      --
      -- Usamos:
      --
      -- counted_stock - current_stock
      --
      -- para que el stock final sea exactamente el conteo físico.
      -- ======================================================

      v_adjustment :=
        item.counted_stock
        - v_current_stock;


      -- ======================================================
      -- APLICAR STOCK FINAL
      -- ======================================================

      UPDATE public.shared_inventory

      SET

        stock =
          item.counted_stock,

        reserved_stock =
          LEAST(
            COALESCE(reserved_stock, 0),
            item.counted_stock
          ),

        updated_at = now()

      WHERE product_id = item.product_id

        AND variant_id
          IS NOT DISTINCT FROM item.variant_id;

    END IF;


    -- ========================================================
    -- REGISTRAR ÚNICAMENTE EL AJUSTE REAL
    -- ========================================================

    IF v_adjustment <> 0 THEN

      INSERT INTO public.inventory_movements(
        branch_id,
        product_id,
        variant_id,
        type,
        quantity,
        reference_id,
        reference_type,
        notes,
        created_by
      )
      VALUES(
        v_count.branch_id,
        item.product_id,
        item.variant_id,

        CASE
          WHEN v_adjustment > 0
            THEN 'adjustment_in'

          ELSE 'adjustment_out'
        END,

        ABS(v_adjustment),

        _count_id,

        'inventory_count',

        CASE
          WHEN v_adjustment > 0
            THEN 'Sobrante de inventario físico central'

          ELSE 'Faltante de inventario físico central'
        END,

        uid
      );

    END IF;

  END LOOP;


  -- ==========================================================
  -- CERRAR INVENTARIO FÍSICO
  -- ==========================================================

  UPDATE public.inventory_counts

  SET

    status = 'completed',

    completed_by = uid,

    completed_at = now()

  WHERE id = _count_id;


END;
$$;


-- ============================================================
-- SEGURIDAD
-- ============================================================

REVOKE ALL

ON FUNCTION public.complete_inventory_count(uuid)

FROM PUBLIC, anon;


GRANT EXECUTE

ON FUNCTION public.complete_inventory_count(uuid)

TO authenticated;


-- ============================================================
-- DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.complete_inventory_count(uuid)

IS

'LULA OS: cierra un inventario físico central de forma segura ante ventas, compras, devoluciones o ajustes concurrentes. La fotografía inicial se conserva para medir la diferencia del conteo y el ajuste real se calcula contra la existencia actual al momento del cierre, dejando el stock final exactamente igual al conteo físico.';


COMMIT;