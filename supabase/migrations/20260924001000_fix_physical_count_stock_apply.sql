BEGIN;

-- ============================================================
-- LULA OS
-- FIX FINAL: APLICACIÓN DEL INVENTARIO FÍSICO
--
-- shared_inventory = existencia única y compartida.
-- branch_id = únicamente contexto histórico del conteo.
--
-- No usamos ON CONFLICT con una expresión dentro del RPC.
-- Primero actualizamos la fila existente.
-- Si no existe, la creamos directamente con la existencia física.
-- ============================================================


CREATE OR REPLACE FUNCTION public.complete_shared_inventory_count(
  _count_id uuid
)
RETURNS TABLE(
  total_items bigint,
  counted_items bigint,
  difference_items bigint,
  shortage_units numeric,
  surplus_units numeric,
  shortage_value numeric,
  surplus_value numeric,
  net_difference_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();

  v_count public.shared_inventory_counts;

  r record;

  v_difference numeric;

  v_shortage_units numeric := 0;
  v_surplus_units numeric := 0;

  v_shortage_value numeric := 0;
  v_surplus_value numeric := 0;

  v_difference_items bigint := 0;
  v_counted_items bigint := 0;
  v_total_items bigint := 0;

  v_branch_id uuid;

  v_existing_inventory_id uuid;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sin permisos para completar inventario físico';
  END IF;


  -- ==========================================================
  -- BLOQUEAR EL CONTEO
  -- ==========================================================

  SELECT *
  INTO v_count
  FROM public.shared_inventory_counts
  WHERE id = _count_id
  FOR UPDATE;

  IF v_count.id IS NULL THEN
    RAISE EXCEPTION 'Inventario físico no encontrado';
  END IF;

  IF v_count.status <> 'open' THEN
    RAISE EXCEPTION
      'El inventario físico ya no está abierto';
  END IF;

  v_branch_id := v_count.branch_id;


  -- ==========================================================
  -- VALIDAR TOTAL DE PRODUCTOS
  -- ==========================================================

  SELECT count(*)
  INTO v_total_items
  FROM public.shared_inventory_count_items
  WHERE count_id = _count_id;


  SELECT count(*)
  INTO v_counted_items
  FROM public.shared_inventory_count_items
  WHERE count_id = _count_id
    AND physical_stock IS NOT NULL;


  IF v_total_items = 0 THEN
    RAISE EXCEPTION
      'El inventario físico no tiene productos';
  END IF;


  IF v_counted_items <> v_total_items THEN
    RAISE EXCEPTION
      'Faltan productos por contar: % de %',
      v_counted_items,
      v_total_items;
  END IF;


  -- ==========================================================
  -- APLICAR CADA DIFERENCIA
  -- ==========================================================

  FOR r IN
    SELECT *
    FROM public.shared_inventory_count_items
    WHERE count_id = _count_id
    ORDER BY product_id, variant_id
    FOR UPDATE
  LOOP

    v_difference :=
      COALESCE(r.physical_stock, 0)
      -
      COALESCE(r.system_stock, 0);


    -- --------------------------------------------------------
    -- RESUMEN DE FALTANTES / SOBRANTES
    -- --------------------------------------------------------

    IF v_difference > 0 THEN

      v_surplus_units :=
        v_surplus_units + v_difference;

      v_surplus_value :=
        v_surplus_value
        +
        (
          v_difference
          *
          COALESCE(r.unit_cost, 0)
        );

    ELSIF v_difference < 0 THEN

      v_shortage_units :=
        v_shortage_units + ABS(v_difference);

      v_shortage_value :=
        v_shortage_value
        +
        (
          ABS(v_difference)
          *
          COALESCE(r.unit_cost, 0)
        );

    END IF;


    -- --------------------------------------------------------
    -- SI HAY DIFERENCIA, AJUSTAR INVENTARIO COMPARTIDO
    -- --------------------------------------------------------

    IF v_difference <> 0 THEN

      v_difference_items :=
        v_difference_items + 1;


      -- ======================================================
      -- BUSCAR FILA EXISTENTE
      --
      -- IS NOT DISTINCT FROM permite que NULL = NULL
      -- para las variantes.
      -- ======================================================

      SELECT id
      INTO v_existing_inventory_id
      FROM public.shared_inventory
      WHERE product_id = r.product_id
        AND variant_id IS NOT DISTINCT FROM r.variant_id
      FOR UPDATE;


      -- ======================================================
      -- CASO 1: YA EXISTE EN shared_inventory
      --
      -- Solo aplicamos la diferencia.
      -- ======================================================

      IF v_existing_inventory_id IS NOT NULL THEN

        UPDATE public.shared_inventory
        SET
          stock = stock + v_difference,
          updated_at = now()
        WHERE id = v_existing_inventory_id;


      -- ======================================================
      -- CASO 2: NO EXISTE
      --
      -- La existencia correcta debe ser la existencia física.
      -- ======================================================

      ELSE

        INSERT INTO public.shared_inventory(
          product_id,
          variant_id,
          stock,
          reserved_stock
        )
        VALUES(
          r.product_id,
          r.variant_id,
          r.physical_stock,
          0
        );

      END IF;


      -- ======================================================
      -- REGISTRAR MOVIMIENTO
      -- ======================================================

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
        v_branch_id,
        r.product_id,
        r.variant_id,

        CASE
          WHEN v_difference > 0
            THEN 'adjustment_in'::public.movement_type
          ELSE
            'adjustment_out'::public.movement_type
        END,

        ABS(v_difference),

        _count_id,

        'shared_inventory_count',

        CASE
          WHEN v_difference > 0
            THEN 'Sobrante detectado en inventario físico'
          ELSE
            'Faltante detectado en inventario físico'
        END,

        uid
      );

    END IF;


    -- ========================================================
    -- GUARDAR DIFERENCIA DEFINITIVA DEL CONTEO
    -- ========================================================

    UPDATE public.shared_inventory_count_items
    SET
      difference = v_difference,

      difference_value =
        v_difference
        *
        COALESCE(r.unit_cost, 0),

      counted_by =
        COALESCE(counted_by, uid),

      counted_at =
        COALESCE(counted_at, now())

    WHERE id = r.id;

  END LOOP;


  -- ==========================================================
  -- CERRAR INVENTARIO
  -- ==========================================================

  UPDATE public.shared_inventory_counts
  SET
    status = 'completed',
    completed_by = uid,
    completed_at = now()
  WHERE id = _count_id;


  -- ==========================================================
  -- DEVOLVER RESUMEN
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_total_items,
    v_counted_items,
    v_difference_items,
    v_shortage_units,
    v_surplus_units,
    v_shortage_value,
    v_surplus_value,
    v_surplus_value - v_shortage_value;

END;
$$;


-- ============================================================
-- SEGURIDAD
-- ============================================================

REVOKE ALL
ON FUNCTION public.complete_shared_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_shared_inventory_count(uuid)
TO authenticated, service_role;


COMMIT;