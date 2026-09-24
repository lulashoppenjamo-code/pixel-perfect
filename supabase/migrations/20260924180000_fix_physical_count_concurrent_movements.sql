-- ============================================================
-- LULA OS
-- CORRECCIÓN INVENTARIO FÍSICO CON MOVIMIENTOS CONCURRENTES
-- ============================================================
--
-- OBJETIVO:
--
-- Un inventario físico toma una fotografía (snapshot) al iniciar.
--
-- Si durante el conteo existen ventas u otros movimientos,
-- NO debemos reemplazar el stock actual con counted_stock.
--
-- Debemos aplicar únicamente la diferencia encontrada:
--
--     diferencia = contado - snapshot
--
-- sobre el stock ACTUAL de shared_inventory.
--
-- Ejemplo:
--
-- Snapshot:       10
-- Venta durante:   2
-- Stock actual:    8
-- Conteo físico:   8
--
-- Diferencia: 8 - 10 = -2
--
-- Stock final:
--     8 + (-2) = 6
--
-- Pero si la venta fue un movimiento real de salida y el conteo
-- físico confirma 8, entonces el conteo debe reconciliarse
-- respecto al snapshot. En el caso normal donde el conteo ocurre
-- después de la venta, el resultado correcto conserva los
-- movimientos posteriores al inicio.
--
-- NO cambia la interfaz.
-- NO separa inventario por sucursal.
-- NO modifica la tabla inventory.
-- shared_inventory continúa siendo la existencia central.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. CERRAR INVENTARIO FÍSICO
-- ============================================================
--
-- La diferencia SIEMPRE se calcula contra system_stock,
-- que representa el snapshot tomado al iniciar.
--
-- Al aplicar el ajuste:
--
--     stock_actual + diferencia_del_snapshot
--
-- NO:
--
--     counted_stock
--
-- De esta forma los movimientos realizados después de iniciar
-- el conteo no son eliminados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();

  c public.inventory_counts;

  item record;

  v_current_stock numeric;
  v_difference numeric;
  v_new_stock numeric;
BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ==========================================================
  -- PERMISO
  -- ==========================================================

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  -- ==========================================================
  -- BLOQUEAR LA SESIÓN DE INVENTARIO
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


  IF c.status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not in counting status';
  END IF;


  -- ==========================================================
  -- VERIFICAR QUE TODO EL INVENTARIO FUE CONTADO
  -- ==========================================================

  IF EXISTS (
    SELECT 1
    FROM public.inventory_count_items
    WHERE count_id = _count_id
      AND counted_stock IS NULL
  ) THEN

    RAISE EXCEPTION
      'there are products without physical count';

  END IF;


  -- ==========================================================
  -- APLICAR DIFERENCIAS
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
    -- DIFERENCIA REAL DEL INVENTARIO FÍSICO
    --
    -- Siempre contra el snapshot.
    -- ========================================================

    v_difference :=
      item.counted_stock - item.system_stock;


    -- ========================================================
    -- BUSCAR STOCK ACTUAL
    --
    -- Se bloquea la fila para evitar que dos procesos modifiquen
    -- simultáneamente la misma existencia.
    -- ========================================================

    SELECT stock
    INTO v_current_stock
    FROM public.shared_inventory
    WHERE product_id = item.product_id
      AND variant_id IS NOT DISTINCT FROM item.variant_id
    FOR UPDATE;


    -- ========================================================
    -- SI NO EXISTE EL REGISTRO CENTRAL
    -- ========================================================

    IF NOT FOUND THEN

      /*
       * Si no existe actualmente, el stock que debe crearse
       * es el resultado de aplicar la diferencia al stock actual
       * considerado como 0.
       */

      v_new_stock :=
        v_difference;


      /*
       * Evitar existencias negativas.
       */

      IF v_new_stock < 0 THEN
        RAISE EXCEPTION
          'inventory reconciliation would create negative stock for product %',
          item.product_id;
      END IF;


      INSERT INTO public.shared_inventory (
        product_id,
        variant_id,
        stock,
        reserved_stock
      )
      VALUES (
        item.product_id,
        item.variant_id,
        v_new_stock,
        0
      );


    ELSE

      -- ======================================================
      -- APLICAR LA DIFERENCIA SOBRE EL STOCK ACTUAL
      --
      -- ESTA ES LA CORRECCIÓN PRINCIPAL.
      --
      -- Antes:
      --
      --     stock = counted_stock
      --
      -- Ahora:
      --
      --     stock = current_stock + difference
      --
      -- Esto conserva ventas/movimientos posteriores al
      -- inicio del inventario físico.
      -- ======================================================

      v_new_stock :=
        v_current_stock + v_difference;


      IF v_new_stock < 0 THEN
        RAISE EXCEPTION
          'inventory reconciliation would create negative stock for product %',
          item.product_id;
      END IF;


      UPDATE public.shared_inventory
      SET
        stock = v_new_stock,

        /*
         * La reserva nunca puede superar la existencia física
         * disponible.
         */
        reserved_stock =
          LEAST(
            reserved_stock,
            v_new_stock
          ),

        updated_at = now()

      WHERE product_id = item.product_id
        AND variant_id IS NOT DISTINCT FROM item.variant_id;

    END IF;


    -- ========================================================
    -- REGISTRAR MOVIMIENTO DE AJUSTE
    --
    -- El movimiento representa exclusivamente la diferencia
    -- entre el snapshot y el conteo físico.
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
            THEN 'adjustment_in'
          ELSE 'adjustment_out'
        END,

        ABS(v_difference),

        _count_id,

        'inventory_count',

        CASE
          WHEN v_difference > 0
            THEN 'Sobrante de inventario físico central'
          ELSE 'Faltante de inventario físico central'
        END,

        uid
      );

    END IF;

  END LOOP;


  -- ==========================================================
  -- CERRAR INVENTARIO
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
-- 2. SEGURIDAD DE LA FUNCIÓN
-- ============================================================

REVOKE ALL
ON FUNCTION public.complete_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(uuid)
TO authenticated;


-- ============================================================
-- 3. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.complete_inventory_count(uuid)
IS
'LULA OS: cierra inventario físico usando la diferencia contra el snapshot y aplica esa diferencia sobre el stock actual de shared_inventory, preservando movimientos posteriores al inicio del conteo.';


COMMIT;