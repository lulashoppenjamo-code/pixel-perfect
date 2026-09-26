-- ============================================================
-- LULA OS
-- CORRECCIÓN FINAL — INVENTARIO FÍSICO CON MOVIMIENTOS
-- DURANTE EL CONTEO
-- 2026-09-25
--
-- OBJETIVO:
--
-- El inventario físico utiliza un snapshot al iniciar.
--
-- Durante el conteo pueden ocurrir:
--   - ventas
--   - devoluciones
--   - compras
--   - ajustes
--
-- Por eso NO debemos hacer:
--
--   stock = counted_stock
--
-- porque eso puede borrar movimientos ocurridos después
-- del snapshot.
--
-- La corrección es:
--
--   diferencia_física =
--       contado - stock_del_snapshot
--
--   stock_final =
--       stock_actual + diferencia_física
--
-- Así se conservan todos los movimientos realizados
-- durante el inventario físico.
--
-- shared_inventory continúa siendo la única existencia.
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
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  c public.inventory_counts;

  item record;

  v_current_stock numeric;
  v_difference numeric;
  v_final_stock numeric;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- PERMISO
  -- ==========================================================

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- BLOQUEAR EL CONTEO
  -- ==========================================================

  SELECT *
  INTO c
  FROM public.inventory_counts
  WHERE id = _count_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count not found';
  END IF;


  -- ==========================================================
  -- VALIDAR SUCURSAL
  --
  -- La sucursal identifica el conteo.
  -- El stock continúa siendo global.
  -- ==========================================================

  IF c.branch_id IS NULL THEN
    RAISE EXCEPTION
      'inventory count branch is required';
  END IF;


  IF NOT public.can_access_branch(
    c.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for inventory count branch %',
      c.branch_id;
  END IF;


  -- ==========================================================
  -- VALIDAR ESTADO
  -- ==========================================================

  IF c.status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not in counting status';
  END IF;


  -- ==========================================================
  -- NO PERMITIR CONTEO INCOMPLETO
  -- ==========================================================

  IF EXISTS (
    SELECT 1
    FROM public.inventory_count_items
    WHERE count_id = _count_id
      AND counted_stock IS NULL
  )
  THEN

    RAISE EXCEPTION
      'there are products without physical count';

  END IF;


  -- ==========================================================
  -- APLICAR DIFERENCIAS
  --
  -- IMPORTANTE:
  --
  -- system_stock = snapshot inicial
  -- counted_stock = existencia física encontrada
  --
  -- diferencia =
  --     contado - snapshot
  --
  -- Después:
  --
  -- stock actual + diferencia
  --
  -- Esto conserva ventas, compras, devoluciones y ajustes
  -- realizados después de iniciar el conteo.
  -- ==========================================================

  FOR item IN

    SELECT
      i.id,
      i.product_id,
      i.variant_id,
      i.system_stock,
      i.counted_stock,
      i.unit_cost

    FROM public.inventory_count_items i

    WHERE i.count_id = _count_id

  LOOP

    -- ========================================================
    -- BLOQUEAR EXISTENCIA CENTRAL
    -- ========================================================

    SELECT stock

    INTO v_current_stock

    FROM public.shared_inventory

    WHERE product_id = item.product_id

      AND variant_id
        IS NOT DISTINCT FROM
        item.variant_id

    FOR UPDATE;


    -- ========================================================
    -- DIFERENCIA FÍSICA CONTRA SNAPSHOT
    -- ========================================================

    v_difference :=
      item.counted_stock
      -
      item.system_stock;


    -- ========================================================
    -- SI NO EXISTE INVENTARIO CENTRAL
    -- ========================================================

    IF NOT FOUND THEN

      /*
       * El registro desapareció después del snapshot.
       *
       * Para conservar la lógica del conteo:
       *
       * stock actual = 0
       *
       * aplicar diferencia del snapshot.
       */

      v_final_stock :=
        GREATEST(
          v_difference,
          0
        );


      INSERT INTO public.shared_inventory (
        product_id,
        variant_id,
        stock,
        reserved_stock
      )
      VALUES (
        item.product_id,
        item.variant_id,
        v_final_stock,
        0
      );


    ELSE

      -- ======================================================
      -- EXISTENCIA ACTUAL + DIFERENCIA FÍSICA
      -- ======================================================

      v_final_stock :=
        v_current_stock
        +
        v_difference;


      /*
       * Nunca permitir stock físico negativo.
       */

      v_final_stock :=
        GREATEST(
          v_final_stock,
          0
        );


      UPDATE public.shared_inventory

      SET

        stock =
          v_final_stock,

        /*
         * Las reservas existentes siguen siendo válidas,
         * pero nunca pueden superar el stock físico.
         */

        reserved_stock =
          LEAST(
            reserved_stock,
            v_final_stock
          ),

        updated_at =
          now()

      WHERE product_id =
        item.product_id

        AND variant_id
          IS NOT DISTINCT FROM
          item.variant_id;

    END IF;


    -- ========================================================
    -- REGISTRAR DIFERENCIA
    -- ========================================================

    IF ABS(v_difference) > 0.000001 THEN

      INSERT INTO public.inventory_movements (
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

      VALUES (
        c.branch_id,
        item.product_id,
        item.variant_id,

        CASE
          WHEN v_difference > 0
            THEN 'adjustment_in'::public.movement_type

          ELSE
            'adjustment_out'::public.movement_type
        END,

        ABS(v_difference),

        _count_id,

        'inventory_count',

        CASE
          WHEN v_difference > 0
            THEN
              'Sobrante de inventario físico — diferencia contra snapshot'

          ELSE
              'Faltante de inventario físico — diferencia contra snapshot'
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

    status =
      'completed',

    completed_by =
      uid,

    completed_at =
      now()

  WHERE id = _count_id;


END;
$$;


-- ============================================================
-- SEGURIDAD
-- ============================================================

REVOKE ALL

ON FUNCTION public.complete_inventory_count(
  uuid
)

FROM PUBLIC, anon;


GRANT EXECUTE

ON FUNCTION public.complete_inventory_count(
  uuid
)

TO authenticated;


-- ============================================================
-- DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.complete_inventory_count(
  uuid
)

IS
'LULA OS: completa inventario físico usando la diferencia contra el snapshot y aplicándola sobre el stock central actual, preservando ventas, compras, devoluciones y ajustes realizados durante el conteo.';


COMMIT;