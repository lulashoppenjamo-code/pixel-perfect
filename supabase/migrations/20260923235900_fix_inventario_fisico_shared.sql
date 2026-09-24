BEGIN;

-- ============================================================
-- LULA OS
-- FIX INVENTARIO FÍSICO COMPARTIDO
-- ============================================================

-- ------------------------------------------------------------
-- 1. Registrar conteo sin depender de updated_at
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_shared_inventory_count_item(
  _count_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _physical_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF _physical_stock IS NULL THEN
    RAISE EXCEPTION 'La existencia física es obligatoria';
  END IF;

  IF _physical_stock < 0 THEN
    RAISE EXCEPTION 'La existencia física no puede ser negativa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.shared_inventory_counts
    WHERE id = _count_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION
      'El inventario físico no existe o ya fue cerrado';
  END IF;

  UPDATE public.shared_inventory_count_items
  SET
    physical_stock = _physical_stock,
    difference = _physical_stock - system_stock,
    difference_value =
      (_physical_stock - system_stock) * unit_cost,
    counted_by = uid,
    counted_at = now()
  WHERE count_id = _count_id
    AND product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Producto no pertenece a este inventario físico';
  END IF;

END;
$$;


-- ------------------------------------------------------------
-- 2. Completar inventario físico
--
-- shared_inventory sigue siendo el inventario global.
-- branch_id solamente registra dónde se realizó el conteo.
-- ------------------------------------------------------------

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
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

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

  FOR r IN
    SELECT *
    FROM public.shared_inventory_count_items
    WHERE count_id = _count_id
    FOR UPDATE
  LOOP

    v_difference :=
      COALESCE(r.physical_stock, 0)
      - COALESCE(r.system_stock, 0);

    IF v_difference > 0 THEN

      v_surplus_units :=
        v_surplus_units + v_difference;

      v_surplus_value :=
        v_surplus_value
        + (v_difference * r.unit_cost);

    ELSIF v_difference < 0 THEN

      v_shortage_units :=
        v_shortage_units + ABS(v_difference);

      v_shortage_value :=
        v_shortage_value
        + (ABS(v_difference) * r.unit_cost);

    END IF;

    IF v_difference <> 0 THEN

      v_difference_items :=
        v_difference_items + 1;

      INSERT INTO public.shared_inventory(
        product_id,
        variant_id,
        stock,
        reserved_stock
      )
      VALUES(
        r.product_id,
        r.variant_id,
        v_difference,
        0
      )
      ON CONFLICT (
        product_id,
        COALESCE(
          variant_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
      )
      DO UPDATE
      SET
        stock =
          public.shared_inventory.stock
          + EXCLUDED.stock,
        updated_at = now();

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

    UPDATE public.shared_inventory_count_items
    SET
      difference = v_difference,
      difference_value =
        v_difference * r.unit_cost,
      counted_by =
        COALESCE(counted_by, uid),
      counted_at =
        COALESCE(counted_at, now())
    WHERE id = r.id;

  END LOOP;

  UPDATE public.shared_inventory_counts
  SET
    status = 'completed',
    completed_by = uid,
    completed_at = now()
  WHERE id = _count_id;

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


REVOKE ALL
ON FUNCTION public.set_shared_inventory_count_item(
  uuid,
  uuid,
  uuid,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_shared_inventory_count_item(
  uuid,
  uuid,
  uuid,
  numeric
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.complete_shared_inventory_count(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.complete_shared_inventory_count(uuid)
TO authenticated, service_role;


COMMIT;