-- ============================================================
-- LULA OS
-- CORRECCIÓN — INVENTARIO FÍSICO CENTRAL
-- ============================================================
--
-- OBJETIVO:
--
-- El inventario físico debe trabajar sobre shared_inventory,
-- porque shared_inventory es la fuente única de existencia.
--
-- NO elimina inventory.
-- NO elimina datos.
-- NO cambia la interfaz.
-- NO separa inventario por sucursal.
--
-- inventory queda como tabla legacy/compatibilidad.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. INICIAR INVENTARIO FÍSICO
-- ============================================================
--
-- La sucursal se conserva solamente como referencia de quién
-- inició el conteo.
--
-- El stock teórico se toma de shared_inventory.
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_inventory_count(
  _branch_id uuid,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();
  count_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;


  /*
   * Solo puede existir un inventario físico activo
   * para la misma sucursal.
   *
   * El stock continúa siendo GLOBAL.
   */

  IF EXISTS (
    SELECT 1
    FROM public.inventory_counts
    WHERE branch_id = _branch_id
      AND status = 'counting'
  ) THEN
    RAISE EXCEPTION
      'there is already an active inventory count';
  END IF;


  INSERT INTO public.inventory_counts (
    branch_id,
    status,
    notes,
    started_by
  )
  VALUES (
    _branch_id,
    'counting',
    _notes,
    uid
  )
  RETURNING id
  INTO count_id;


  /*
   * SNAPSHOT DEL INVENTARIO CENTRAL.
   *
   * shared_inventory es la fuente real.
   */

  INSERT INTO public.inventory_count_items (
    count_id,
    product_id,
    variant_id,
    system_stock,
    counted_stock,
    unit_cost
  )
  SELECT
    count_id,
    si.product_id,
    si.variant_id,
    si.stock,
    NULL,
    COALESCE(si.cost, 0)
  FROM public.shared_inventory si
  INNER JOIN public.products p
    ON p.id = si.product_id
  WHERE p.is_active = true;


  RETURN count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.start_inventory_count(uuid, text)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.start_inventory_count(uuid, text)
TO authenticated;


-- ============================================================
-- 2. CAPTURAR CONTEO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_count_item(
  _count_id uuid,
  _item_id uuid,
  _counted_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();

  v_system numeric;
  v_cost numeric;

  v_status text;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  IF _counted_stock IS NULL THEN
    RAISE EXCEPTION 'counted stock is required';
  END IF;


  IF _counted_stock < 0 THEN
    RAISE EXCEPTION
      'counted stock cannot be negative';
  END IF;


  SELECT
    c.status,
    i.system_stock,
    i.unit_cost
  INTO
    v_status,
    v_system,
    v_cost
  FROM public.inventory_count_items i
  INNER JOIN public.inventory_counts c
    ON c.id = i.count_id
  WHERE i.id = _item_id
    AND i.count_id = _count_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count item not found';
  END IF;


  IF v_status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not active';
  END IF;


  UPDATE public.inventory_count_items
  SET
    counted_stock = _counted_stock,

    difference =
      _counted_stock - v_system,

    difference_value =
      (_counted_stock - v_system) *
      COALESCE(v_cost, 0),

    counted_at = now()

  WHERE id = _item_id
    AND count_id = _count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
TO authenticated;


-- ============================================================
-- 3. CERRAR INVENTARIO FÍSICO CENTRAL
-- ============================================================
--
-- IMPORTANTE:
--
-- Ya NO actualiza public.inventory.
--
-- Actualiza exclusivamente public.shared_inventory.
--
-- Esto mantiene una sola existencia para las dos sucursales.
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
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


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


  /*
   * No se permite cerrar un inventario incompleto.
   */

  IF EXISTS (
    SELECT 1
    FROM public.inventory_count_items
    WHERE count_id = _count_id
      AND counted_stock IS NULL
  ) THEN

    RAISE EXCEPTION
      'there are products without physical count';

  END IF;


  /*
   * Aplicamos cada diferencia sobre shared_inventory.
   */

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

    /*
     * Buscar existencia central.
     */

    SELECT stock
    INTO v_current_stock
    FROM public.shared_inventory
    WHERE product_id = item.product_id
      AND variant_id IS NOT DISTINCT FROM item.variant_id
    FOR UPDATE;


    /*
     * Si el producto ya no tiene registro central,
     * lo creamos con la cantidad física encontrada.
     */

    IF NOT FOUND THEN

      INSERT INTO public.shared_inventory (
        product_id,
        variant_id,
        stock,
        reserved_stock
      )
      VALUES (
        item.product_id,
        item.variant_id,
        item.counted_stock,
        0
      );

      v_difference =
        item.counted_stock -
        item.system_stock;

    ELSE

      v_difference =
        item.counted_stock -
        v_current_stock;


      /*
       * El conteo físico se convierte en la existencia
       * central definitiva.
       */

      UPDATE public.shared_inventory
      SET
        stock = item.counted_stock,

        /*
         * Nunca permitimos que reservado sea mayor
         * que la existencia física.
         */
        reserved_stock =
          LEAST(
            reserved_stock,
            item.counted_stock
          ),

        updated_at = now()

      WHERE product_id = item.product_id
        AND variant_id IS NOT DISTINCT FROM item.variant_id;

    END IF;


    /*
     * Registrar diferencia.
     *
     * IMPORTANTE:
     * quantity se guarda positiva y el tipo indica
     * si fue entrada o salida.
     */

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


  /*
   * Cerrar sesión.
   */

  UPDATE public.inventory_counts
  SET
    status = 'completed',
    completed_by = uid,
    completed_at = now()
  WHERE id = _count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.complete_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(uuid)
TO authenticated;


-- ============================================================
-- 4. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.start_inventory_count(uuid, text)
IS
'LULA OS: inicia inventario físico tomando snapshot desde shared_inventory.';


COMMENT ON FUNCTION public.set_inventory_count_item(uuid, uuid, numeric)
IS
'LULA OS: captura existencia física contra snapshot del inventario central.';


COMMENT ON FUNCTION public.complete_inventory_count(uuid)
IS
'LULA OS: aplica el inventario físico exclusivamente sobre shared_inventory.';


COMMIT;