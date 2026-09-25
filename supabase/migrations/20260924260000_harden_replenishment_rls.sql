-- ============================================================
-- LULA OS
-- SEGURIDAD FINAL — REPOSICIÓN
-- 2026-09-24
--
-- OBJETIVO:
--   - Evitar lectura global de solicitudes de reposición.
--   - Respetar la sucursal del usuario.
--   - Mantener solicitudes sin sucursal como globales.
--   - El usuario solo puede crear solicitudes a su nombre.
--   - Manager/admin/owner pueden actualizar solicitudes
--     de sucursales a las que tienen acceso.
--
-- IMPORTANTE:
--   NO modifica shared_inventory.
--   NO modifica stock.
--   NO modifica compras.
--   NO modifica ventas.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. ASEGURAR RLS
-- ============================================================

ALTER TABLE public.replenishment_requests
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. LECTURA
--
-- Una solicitud:
--
--   branch_id NULL
--      -> solicitud global
--
--   branch_id con valor
--      -> solamente usuarios con acceso a esa sucursal
--
-- El usuario que creó la solicitud conserva acceso aunque
-- la solicitud no tenga branch_id.
-- ============================================================

DROP POLICY IF EXISTS
replenishment_requests_read
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_read
ON public.replenishment_requests
FOR SELECT
TO authenticated
USING (
  requested_by = auth.uid()
  OR
  branch_id IS NULL
  OR
  public.can_access_branch(branch_id)
);


-- ============================================================
-- 3. CREAR SOLICITUD
--
-- El solicitante siempre debe ser el usuario autenticado.
--
-- Si especifica sucursal:
-- debe tener acceso a ella.
--
-- Si branch_id es NULL:
-- se permite como solicitud global.
-- ============================================================

DROP POLICY IF EXISTS
replenishment_requests_create
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_create
ON public.replenishment_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND
  (
    branch_id IS NULL
    OR
    public.can_access_branch(branch_id)
  )
);


-- ============================================================
-- 4. ACTUALIZAR SOLICITUD
--
-- El manager/admin/owner puede modificar solicitudes dentro
-- de sus sucursales permitidas.
--
-- El colaborador que creó una solicitud puede modificarla
-- mientras siga pendiente.
-- ============================================================

DROP POLICY IF EXISTS
replenishment_requests_update
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_update
ON public.replenishment_requests
FOR UPDATE
TO authenticated
USING (
  (
    requested_by = auth.uid()
    AND status = 'pending'
  )
  OR
  (
    public.is_manager()
    AND
    (
      branch_id IS NULL
      OR
      public.can_access_branch(branch_id)
    )
  )
)
WITH CHECK (
  (
    requested_by = auth.uid()
    AND status = 'pending'
  )
  OR
  (
    public.is_manager()
    AND
    (
      branch_id IS NULL
      OR
      public.can_access_branch(branch_id)
    )
  )
);


-- ============================================================
-- 5. ELIMINACIÓN
--
-- No dejamos DELETE abierto.
--
-- Las solicitudes deben conservar historial.
-- Para cancelar se utiliza status = cancelled.
-- ============================================================

REVOKE DELETE
ON public.replenishment_requests
FROM authenticated;


-- ============================================================
-- 6. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
replenishment_requests_requested_by_idx
ON public.replenishment_requests(requested_by);

CREATE INDEX IF NOT EXISTS
replenishment_requests_branch_status_idx
ON public.replenishment_requests(
  branch_id,
  status
);


COMMIT;