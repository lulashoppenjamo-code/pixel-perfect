-- ============================================================
-- LULA OS — INVENTARIO FÍSICO COMPARTIDO
-- ============================================================
-- Fuente única de existencia:
-- public.shared_inventory
--
-- NO crea inventarios separados por sucursal.
-- El branch_id únicamente se conserva como contexto/auditoría
-- mediante inventory_movements.
-- ============================================================


-- ============================================================
-- 1. CABECERA DEL CONTEO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

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

  completed_at timestamptz
);


CREATE INDEX IF NOT EXISTS
shared_inventory_counts_status_idx
ON public.shared_inventory_counts(
  status,
  started_at DESC
);


-- ============================================================
-- 2. PRODUCTOS DEL CONTEO
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
    ON DELETE CASCADE,

  system_stock numeric(12,2) NOT NULL DEFAULT 0,

  physical_stock numeric(12,2),

  difference numeric(12,2),

  unit_cost numeric(12,2) NOT NULL DEFAULT 0,

  difference_value numeric(12,2),

  counted_by uuid,

  counted_at timestamptz
);


CREATE UNIQUE INDEX IF NOT EXISTS
shared_inventory_count_item_unique
ON public.shared_inventory_count_items(
  count_id,
  product_id,
  variant_id
);


CREATE INDEX IF NOT EXISTS
shared_inventory_count_items_count_idx
ON public.shared_inventory_count_items(
  count_id
);


-- ============================================================
-- 3. SEGURIDAD
-- ============================================================

ALTER TABLE public.shared_inventory_counts
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shared_inventory_count_items
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
shared_inventory_counts_select
ON public.shared_inventory_counts;

CREATE POLICY
shared_inventory_counts_select
ON public.shared_inventory_counts
FOR SELECT
TO authenticated
USING (true);


DROP POLICY IF EXISTS
shared_inventory_counts_insert
ON public.shared_inventory_counts;

CREATE POLICY
shared_inventory_counts_insert
ON public.shared_inventory_counts
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);


DROP POLICY IF EXISTS
shared_inventory_counts_update
ON public.shared_inventory_counts;

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

CREATE POLICY
shared_inventory_count_items_select
ON public.shared_inventory_count_items
FOR SELECT
TO authenticated
USING (true);


DROP POLICY IF EXISTS
shared_inventory_count_items_insert
ON public.shared_inventory_count_items;

CREATE POLICY
shared_inventory_count_items_insert
ON public.shared_inventory_count_items
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_manager()
);


DROP POLICY IF EXISTS
shared_inventory_count_items_update
ON public.shared_inventory_count_items;

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


-- ============================================================
-- 4. INICIAR CONTEO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_shared_inventory_count(
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
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  -- Solo un inventario físico abierto.
  IF EXISTS (
    SELECT 1
    FROM public.shared_inventory_counts
    WHERE status = 'open'
  ) THEN
    RAISE EXCEPTION
      'Ya existe un inventario físico abierto';
  END IF;


  INSERT INTO public.shared_inventory_counts(
    status,
    notes,
    started_by
  )
  VALUES(
    'open',
    _notes,
    uid
  )
  RETURNING id
  INTO v_count_id;


  -- Tomamos una fotografía del inventario compartido.
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
    si.stock,

    COALESCE(
      pv.cost_override,
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
ON FUNCTION public.start_shared_inventory_count(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_shared_inventory_count(text)
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
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _physical_stock IS NULL THEN
    RAISE EXCEPTION
      'physical stock is required';
  END IF;

  IF _physical_stock < 0 THEN
    RAISE EXCEPTION
      'physical stock cannot be negative';
  END IF;


  UPDATE public.shared_inventory_count_items
  SET
    physical_stock = _physical_stock,

    difference =
      _physical_stock - system_stock,

    difference_value =
      (_physical_stock - system_stock) * unit_cost,

    counted_by = uid,

    counted_at = now()

  WHERE count_id = _count_id

    AND product_id = _product_id

    AND (
      (
        variant_id IS NULL
        AND _variant_id IS NULL
      )
      OR variant_id = _variant_id
    );


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count item not found';
  END IF;

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


-- ============================================================
-- 6. CANCELAR CONTEO
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
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  UPDATE public.shared_inventory_counts
  SET
    status = 'cancelled',
    completed_by = uid,
    completed_at = now()

  WHERE id = _count_id
    AND status = 'open';


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count not found or already closed';
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
-- 7. COMPLETAR INVENTARIO FÍSICO
-- ============================================================
-- IMPORTANTE:
-- No modifica directamente shared_inventory.
-- Utiliza adjust_stock(), que ya está conectado al motor
-- shared_inventory.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_shared_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_count public.shared_inventory_counts;
  v_branch_id uuid;
  r record;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  SELECT *
  INTO v_count
  FROM public.shared_inventory_counts
  WHERE id = _count_id
  FOR UPDATE;


  IF v_count.id IS NULL THEN
    RAISE EXCEPTION
      'inventory count not found';
  END IF;


  IF v_count.status <> 'open' THEN
    RAISE EXCEPTION
      'inventory count is not open';
  END IF;


  -- Usamos una sucursal únicamente como contexto histórico
  -- para inventory_movements.
  SELECT id
  INTO v_branch_id
  FROM public.branches
  WHERE is_active = true
  ORDER BY id
  LIMIT 1;


  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION
      'No active branch exists';
  END IF;


  -- No permitimos terminar el conteo con productos sin contar.
  IF EXISTS (
    SELECT 1
    FROM public.shared_inventory_count_items
    WHERE count_id = _count_id
      AND physical_stock IS NULL
  ) THEN

    RAISE EXCEPTION
      'all inventory items must be counted first';

  END IF;


  FOR r IN
    SELECT *
    FROM public.shared_inventory_count_items
    WHERE count_id = _count_id
    ORDER BY product_id, variant_id
  LOOP


    -- Actualizar diferencia calculada.
    UPDATE public.shared_inventory_count_items
    SET
      difference =
        r.physical_stock - r.system_stock,

      difference_value =
        (
          r.physical_stock - r.system_stock
        ) * r.unit_cost,

      counted_by =
        COALESCE(r.counted_by, uid),

      counted_at =
        COALESCE(r.counted_at, now())

    WHERE id = r.id;


    -- Si existe diferencia, modificar el stock compartido.
    IF r.physical_stock <> r.system_stock THEN

      PERFORM public.adjust_stock(
        v_branch_id,
        r.product_id,
        r.physical_stock - r.system_stock,
        r.variant_id,
        CASE
          WHEN r.physical_stock > r.system_stock
          THEN
            'Inventario físico - sobrante'
          ELSE
            'Inventario físico - faltante'
        END
      );

    END IF;

  END LOOP;


  UPDATE public.shared_inventory_counts
  SET
    status = 'completed',
    completed_by = uid,
    completed_at = now()

  WHERE id = _count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.complete_shared_inventory_count(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.complete_shared_inventory_count(uuid)
TO authenticated, service_role;


-- ============================================================
-- 8. RESUMEN DEL CONTEO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_inventory_count_summary(
  _count_id uuid
)
RETURNS TABLE (
  total_items bigint,
  counted_items bigint,
  pending_items bigint,
  shortage_items bigint,
  surplus_items bigint,
  total_shortage_value numeric,
  total_surplus_value numeric,
  net_difference_value numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT

    COUNT(*)::bigint,

    COUNT(*) FILTER (
      WHERE physical_stock IS NOT NULL
    )::bigint,

    COUNT(*) FILTER (
      WHERE physical_stock IS NULL
    )::bigint,

    COUNT(*) FILTER (
      WHERE difference < 0
    )::bigint,

    COUNT(*) FILTER (
      WHERE difference > 0
    )::bigint,

    COALESCE(
      SUM(
        ABS(difference_value)
      ) FILTER (
        WHERE difference < 0
      ),
      0
    ),

    COALESCE(
      SUM(
        ABS(difference_value)
      ) FILTER (
        WHERE difference > 0
      ),
      0
    ),

    COALESCE(
      SUM(difference_value),
      0
    )

  FROM public.shared_inventory_count_items

  WHERE count_id = _count_id;
$$;


REVOKE ALL
ON FUNCTION public.get_shared_inventory_count_summary(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_shared_inventory_count_summary(uuid)
TO authenticated, service_role;


-- ============================================================
-- FIN
-- ============================================================