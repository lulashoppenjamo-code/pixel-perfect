-- ============================================================
-- LULA SHOP OS
-- ADMINISTRACIÓN SEGURA DE SUCURSALES
--
-- "Eliminar" una sucursal significa desactivarla.
-- NO se elimina historial ni datos operativos.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_branch(
  _branch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_branch_count integer;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = _branch_id
  ) THEN
    RAISE EXCEPTION 'branch not found';
  END IF;

  SELECT count(*)
  INTO active_branch_count
  FROM public.branches
  WHERE is_active = true;

  IF active_branch_count <= 1 THEN
    RAISE EXCEPTION
      'cannot delete the last active branch';
  END IF;

  -- Los usuarios que estaban asignados quedan
  -- sin sucursal para no conservar una referencia
  -- a una sucursal que ya no está activa.
  UPDATE public.profiles
  SET
    branch_id = NULL,
    updated_at = now()
  WHERE branch_id = _branch_id;

  -- Eliminación lógica:
  -- se conserva todo el historial.
  UPDATE public.branches
  SET
    is_active = false
  WHERE id = _branch_id;

END;
$$;

REVOKE ALL
ON FUNCTION public.admin_delete_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_delete_branch(uuid)
TO authenticated, service_role;

COMMIT;