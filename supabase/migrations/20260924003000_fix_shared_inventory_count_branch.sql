BEGIN;

-- ============================================================
-- LULA OS
-- FIX: CONTEXTO DE SUCURSAL DEL INVENTARIO FÍSICO
--
-- IMPORTANTE:
-- El stock sigue siendo ÚNICO Y COMPARTIDO.
--
-- branch_id NO crea inventario separado.
-- Solo indica en qué sucursal se realizó el conteo.
-- ============================================================


-- ============================================================
-- 1. AGREGAR branch_id A LA CABECERA DEL CONTEO
-- ============================================================

ALTER TABLE public.shared_inventory_counts
ADD COLUMN IF NOT EXISTS branch_id uuid;


-- ============================================================
-- 2. ÍNDICE
-- ============================================================

CREATE INDEX IF NOT EXISTS
shared_inventory_counts_branch_idx
ON public.shared_inventory_counts(branch_id);


-- ============================================================
-- 3. NUEVA FUNCIÓN PARA INICIAR CONTEO
--
-- El frontend envía:
-- _branch_id
-- _notes
--
-- shared_inventory sigue siendo global.
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
    RAISE EXCEPTION 'Sin permisos para iniciar inventario físico';
  END IF;


  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'La sucursal es obligatoria';
  END IF;


  -- ==========================================================
  -- VALIDAR QUE LA SUCURSAL EXISTA
  -- ==========================================================

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
  ) THEN
    RAISE EXCEPTION 'La sucursal seleccionada no existe';
  END IF;


  -- ==========================================================
  -- SOLO UN INVENTARIO FÍSICO ABIERTO A LA VEZ
  -- ==========================================================

  IF EXISTS (
    SELECT 1
    FROM public.shared_inventory_counts
    WHERE status = 'open'
  ) THEN

    RAISE EXCEPTION
      'Ya existe un inventario físico abierto';

  END IF;


  -- ==========================================================
  -- CREAR CABECERA
  -- ==========================================================

  INSERT INTO public.shared_inventory_counts(
    status,
    notes,
    started_by,
    branch_id
  )
  VALUES(
    'open',
    _notes,
    uid,
    _branch_id
  )
  RETURNING id
  INTO v_count_id;


  -- ==========================================================
  -- TOMAR FOTOGRAFÍA DEL INVENTARIO GLOBAL
  --
  -- IMPORTANTE:
  -- NO SE FILTRA POR branch_id.
  -- Las dos sucursales comparten este inventario.
  -- ==========================================================

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


-- ============================================================
-- 4. PERMISOS
-- ============================================================

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
-- 5. SEGURIDAD DEL branch_id
-- ============================================================
--
-- Los usuarios no deben poder modificar directamente
-- la sucursal de un conteo desde el cliente.
--
-- Las operaciones principales se realizan mediante RPC.
-- ============================================================

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


COMMIT;