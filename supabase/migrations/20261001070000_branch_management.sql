-- ============================================================
-- LULA SHOP OS
-- ADMINISTRACIÓN SEGURA DE SUCURSALES
--
-- "Eliminar" una sucursal significa desactivarla.
-- NO se elimina historial ni datos operativos.
-- NO modifica el inventario global.
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

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = _branch_id
  ) THEN
    RAISE EXCEPTION 'branch not found';
  END IF;

  -- Si ya está desactivada, no hacemos nada.
  IF EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = _branch_id
      AND b.is_active = false
  ) THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO active_branch_count
  FROM public.branches
  WHERE is_active = true;

  -- Nunca permitir dejar el sistema sin sucursales activas.
  IF active_branch_count <= 1 THEN
    RAISE EXCEPTION
      'cannot delete the last active branch';
  END IF;

  -- Los usuarios de esa sucursal quedan sin sucursal.
  -- No se elimina ningún usuario.
  UPDATE public.profiles
  SET
    branch_id = NULL,
    updated_at = now()
  WHERE branch_id = _branch_id;

  -- Eliminación lógica.
  -- Todo el historial permanece intacto.
  UPDATE public.branches
  SET
    is_active = false
  WHERE id = _branch_id;

  -- Confirmar que realmente quedó desactivada.
  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = false
  ) THEN
    RAISE EXCEPTION
      'branch could not be deactivated';
  END IF;

END;
$$;

REVOKE ALL
ON FUNCTION public.admin_delete_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_delete_branch(uuid)
TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_delete_branch(uuid)
IS
'LULA OS: desactiva una sucursal sin eliminar historial ni inventario global. Requiere owner/admin activo y nunca permite desactivar la última sucursal activa.';

COMMIT;