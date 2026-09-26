-- ============================================================
-- LULA OS
-- FASE 4 - BLOQUE A
-- INVENTARIO FÍSICO PROFESIONAL SOBRE SHARED_INVENTORY
--
-- IMPORTANTE:
-- shared_inventory continúa siendo la ÚNICA fuente operativa
-- de existencia.
--
-- NO se crean existencias por sucursal.
-- branch_id solamente identifica dónde se realizó el conteo.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SESIONES DE INVENTARIO FÍSICO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  branch_id uuid NOT NULL
    REFERENCES public.branches(id)
    ON DELETE RESTRICT,

  status text NOT NULL DEFAULT 'open'
    CHECK (
      status IN (
        'open',
        'completed',
        'cancelled'
      )
    ),

  notes text,

  started_by uuid NOT NULL,

  completed_by uuid,

  started_at timestamptz NOT NULL DEFAULT now(),

  completed_at timestamptz,

  cancelled_at timestamptz,

  cancelled_by uuid
);

CREATE INDEX IF NOT EXISTS
shared_inventory_counts_branch_started_idx
ON public.shared_inventory_counts(
  branch_id,
  started_at DESC
);

CREATE INDEX IF NOT EXISTS
shared_inventory_counts_status_idx
ON public.shared_inventory_counts(
  status,
  started_at DESC
);


-- ============================================================
-- 2. DETALLE DEL CONTEO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  count_id uuid NOT NULL
    REFERENCES public.shared_inventory_counts(id)
    ON DELETE CASCADE,

  product_id uuid NOT NULL
    REFERENCES public.products(id)
    ON DELETE CASCADE,

  variant_id uuid
    REFERENCES public.product_variants(id)
    ON DELETE SET NULL,

  system_stock numeric(12,2) NOT NULL DEFAULT 0,

  physical_stock numeric(12,2),

  difference numeric(12,2),

  unit_cost numeric(12,2) NOT NULL DEFAULT 0,

  difference_value numeric(12,2),

  counted_by uuid,

  counted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE UNIQUE INDEX IF NOT EXISTS
shared_inventory_count_item_unique
ON public.shared_inventory_count_items(
  count_id,
  product_id,
  COALESCE(
    variant_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);


CREATE INDEX IF NOT EXISTS
shared_inventory_count_items_count_idx
ON public.shared_inventory_count_items(
  count_id
);


CREATE INDEX IF NOT EXISTS
shared_inventory_count_items_product_idx
ON public.shared_inventory_count_items(
  product_id
);


-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.shared_inventory_counts
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shared_inventory_count_items
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
shared_inventory_counts_select
ON public.shared_inventory_counts;

DROP POLICY IF EXISTS
shared_inventory_counts_insert
ON public.shared_inventory_counts;

DROP POLICY IF EXISTS
shared_inventory_counts_update
ON public.shared_inventory_counts;


CREATE POLICY
shared_inventory_counts_select
ON public.shared_inventory_counts
FOR SELECT
TO authenticated
USING (
  public.is_manager()
);


CREATE POLICY
shared_inventory_counts_insert
ON public.shared_inventory_counts
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);


CREATE POLICY
shared_inventory_counts_update
ON public.shared_inventory_counts
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);


DROP POLICY IF EXISTS
shared_inventory_count_items_select
ON public.shared_inventory_count_items;

DROP POLICY IF EXISTS
shared_inventory_count_items_insert
ON public.shared_inventory_count_items;

DROP POLICY IF EXISTS
shared_inventory_count_items_update
ON public.shared_inventory_count_items;


CREATE POLICY
shared_inventory_count_items_select
ON public.shared_inventory_count_items
FOR SELECT
TO authenticated
USING (
  public.is_manager()
);


CREATE POLICY
shared_inventory_count_items_insert
ON public.shared_inventory_count_items
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);


CREATE POLICY
shared_inventory_count_items_update
ON public.shared_inventory_count_items
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);


GRANT SELECT, INSERT, UPDATE
ON public.shared_inventory_counts
TO authenticated;


GRANT SELECT, INSERT, UPDATE
ON public.shared_inventory_count_items
TO authenticated;


GRANT ALL
ON public.shared_inventory_counts,
   public.shared_inventory_count_items
TO service_role;


-- ============================================================
-- 4. INICIAR CONTEO FÍSICO
--
-- IMPORTANTE:
-- Hace snapshot del stock CENTRAL en el momento de iniciar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_shared_inventory_count(
  _branch_id uuid,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_count_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'Sin permisos para iniciar inventario físico';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION
      'Sucursal no encontrada o inactiva';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM public.shared_inventory_counts
    WHERE status = 'open'
  ) THEN
    RAISE EXCEPTION
      'Ya existe un inventario físico abierto';
  END IF;


  INSERT INTO public.shared_inventory_counts(
    branch_id,
    status,
    notes,
    started_by
  )
  VALUES(
    _branch_id,
    'open',
    _notes,
    uid
  )
  RETURNING id
  INTO v_count_id;


  INSERT INTO public.shared_inventory_count_items(
    count_id,
    product_id,
    variant_id,
    system_stock,
    unit_cost
  )
  SELECT
    v_count_id,

    si.product_id,

    si.variant_id,

    COALESCE(si.stock, 0),

    COALESCE(
      CASE
        WHEN si.variant_id IS NOT NULL
        THEN pv.cost_override
        ELSE NULL
      END,
      p.cost,
      0
    )

  FROM public.shared_inventory si

  INNER JOIN public.products p
    ON p.id = si.product_id

  LEFT JOIN public.product_variants pv
    ON pv.id = si.variant_id

  WHERE p.is_active = true;


  RETURN v_count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.start_shared_inventory_count(
  uuid,
  text
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.start_shared_inventory_count(
  uuid,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 5. REGISTRAR CONTEO
-- ============================================================

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
    RAISE EXCEPTION
      'La existencia física es obligatoria';
  END IF;

  IF _physical_stock < 0 THEN
    RAISE EXCEPTION
      'La existencia física no puede ser negativa';
  END IF;


  UPDATE public.shared_inventory_count_items
  SET
    physical_stock = _physical_stock,

    difference =
      _physical_stock - system_stock,

    difference_value =
      (
        _physical_stock - system_stock
      ) * unit_cost,

    counted_by = uid,

    counted_at = now()

  WHERE count_id = _count_id

    AND product_id = _product_id

    AND variant_id
      IS NOT DISTINCT FROM _variant_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Producto no pertenece a este inventario físico';
  END IF;


  UPDATE public.shared_inventory_counts
  SET
    updated_at = now()
  WHERE id = _count_id;

END;
$$;


-- ============================================================
-- 6. COMPLETAR INVENTARIO
--
-- Este procedimiento:
--
-- 1. Verifica que todos estén contados.
-- 2. Calcula diferencias.
-- 3. Ajusta shared_inventory.
-- 4. Registra movimiento.
-- 5. Guarda valor de faltantes/sobrantes.
-- 6. Cierra la sesión.
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
    RAISE EXCEPTION
      'Inventario físico no encontrado';
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


  -- ==========================================================
  -- RECORRER DIFERENCIAS
  -- ==========================================================

  FOR r IN
    SELECT *
    FROM public.shared_inventory_count_items
    WHERE count_id = _count_id
    FOR UPDATE
  LOOP

    r.difference :=
      r.physical_stock - r.system_stock;


    IF r.difference > 0 THEN

      v_surplus_units :=
        v_surplus_units + r.difference;

      v_surplus_value :=
        v_surplus_value
        +
        (
          r.difference * r.unit_cost
        );

    ELSIF r.difference < 0 THEN

      v_shortage_units :=
        v_shortage_units
        + ABS(r.difference);

      v_shortage_value :=
        v_shortage_value
        +
        (
          ABS(r.difference)
          * r.unit_cost
        );

    END IF;


    IF r.difference <> 0 THEN

      v_difference_items :=
        v_difference_items + 1;


      -- ======================================================
      -- AJUSTE DIRECTO SOBRE SHARED_INVENTORY
      -- ======================================================

      INSERT INTO public.shared_inventory(
        product_id,
        variant_id,
        stock,
        reserved_stock
      )
      VALUES(
        r.product_id,
        r.variant_id,
        r.difference,
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


      -- ======================================================
      -- MOVIMIENTO
      --
      -- branch_id solamente identifica dónde se realizó
      -- físicamente el conteo.
      --
      -- EL STOCK SIGUE SIENDO GLOBAL.
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
          WHEN r.difference > 0
          THEN 'adjustment_in'::public.movement_type
          ELSE 'adjustment_out'::public.movement_type
        END,

        ABS(r.difference),

        _count_id,

        'shared_inventory_count',

        CASE
          WHEN r.difference > 0
          THEN 'Sobrante detectado en inventario físico'
          ELSE 'Faltante detectado en inventario físico'
        END,

        uid
      );

    END IF;


    -- Guardar resultado definitivo
    UPDATE public.shared_inventory_count_items
    SET
      difference = r.difference,

      difference_value =
        r.difference * r.unit_cost,

      counted_by =
        COALESCE(counted_by, uid),

      counted_at =
        COALESCE(counted_at, now())

    WHERE id = r.id;

  END LOOP;


  -- ==========================================================
  -- CERRAR SESIÓN
  -- ==========================================================

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
ON FUNCTION public.complete_shared_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_shared_inventory_count(uuid)
TO authenticated, service_role;


-- ============================================================
-- 7. CANCELAR INVENTARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_shared_inventory_count(
  _count_id uuid
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


  UPDATE public.shared_inventory_counts
  SET
    status = 'cancelled',

    cancelled_by = uid,

    cancelled_at = now()

  WHERE id = _count_id
    AND status = 'open';


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'El inventario no existe o ya fue cerrado';
  END IF;

END;
$$;


REVOKE ALL
ON FUNCTION public.cancel_shared_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.cancel_shared_inventory_count(uuid)
TO authenticated, service_role;


-- ============================================================
-- 8. RESUMEN DE UN INVENTARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_inventory_count_summary(
  _count_id uuid
)
RETURNS TABLE(
  total_items bigint,
  counted_items bigint,
  pending_items bigint,
  difference_items bigint,
  shortage_units numeric,
  surplus_units numeric,
  shortage_value numeric,
  surplus_value numeric,
  net_difference_value numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT

    count(*)::bigint
      AS total_items,

    count(*) FILTER (
      WHERE physical_stock IS NOT NULL
    )::bigint
      AS counted_items,

    count(*) FILTER (
      WHERE physical_stock IS NULL
    )::bigint
      AS pending_items,

    count(*) FILTER (
      WHERE difference IS NOT NULL
        AND difference <> 0
    )::bigint
      AS difference_items,

    COALESCE(
      SUM(
        CASE
          WHEN difference < 0
          THEN ABS(difference)
          ELSE 0
        END
      ),
      0
    )
      AS shortage_units,

    COALESCE(
      SUM(
        CASE
          WHEN difference > 0
          THEN difference
          ELSE 0
        END
      ),
      0
    )
      AS surplus_units,

    COALESCE(
      SUM(
        CASE
          WHEN difference < 0
          THEN ABS(difference_value)
          ELSE 0
        END
      ),
      0
    )
      AS shortage_value,

    COALESCE(
      SUM(
        CASE
          WHEN difference > 0
          THEN difference_value
          ELSE 0
        END
      ),
      0
    )
      AS surplus_value,

    COALESCE(
      SUM(difference_value),
      0
    )
      AS net_difference_value

  FROM public.shared_inventory_count_items

  WHERE count_id = _count_id;

$$;


GRANT EXECUTE
ON FUNCTION public.get_shared_inventory_count_summary(uuid)
TO authenticated;


-- ============================================================
-- 9. DOCUMENTACIÓN
-- ============================================================

COMMENT ON TABLE public.shared_inventory_counts IS
'LULA OS: sesiones de inventario físico sobre el inventario compartido.';

COMMENT ON TABLE public.shared_inventory_count_items IS
'LULA OS: snapshot y conteo físico de cada producto del inventario compartido.';

COMMENT ON FUNCTION public.start_shared_inventory_count(uuid,text) IS
'LULA OS: inicia una sesión de inventario físico usando shared_inventory como fuente de existencia.';

COMMENT ON FUNCTION public.complete_shared_inventory_count(uuid) IS
'LULA OS: finaliza un inventario físico, calcula faltantes/sobrantes y ajusta shared_inventory.';

COMMENT ON FUNCTION public.cancel_shared_inventory_count(uuid) IS
'LULA OS: cancela una sesión de inventario físico sin modificar existencias.';

COMMIT;