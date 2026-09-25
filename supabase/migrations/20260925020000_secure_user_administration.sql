-- ============================================================
-- LULA OS
-- SEGURIDAD — ADMINISTRACIÓN DE USUARIOS
-- 2026-09-25
--
-- OBJETIVOS:
-- 1. Solo owner/admin pueden administrar usuarios.
-- 2. Rol, sucursal y activación se cambian mediante RPC.
-- 3. La operación es atómica.
-- 4. Un usuario normal solo puede modificar full_name.
-- 5. Un usuario no puede autoactivarse.
-- 6. Un usuario no puede cambiarse de sucursal.
-- 7. Un usuario no puede cambiarse su propio rol.
-- 8. No permite que un admin modifique un owner.
-- 9. El owner tampoco puede desactivarse a sí mismo.
--
-- NO:
-- - modifica inventario
-- - modifica ventas
-- - modifica caja
-- - divide inventario por sucursal
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PERMISOS DE COLUMNAS DE PROFILES
-- ============================================================
--
-- Los usuarios autenticados solamente necesitan poder modificar
-- su nombre.
--
-- Los cambios administrativos de branch_id / is_active se harán
-- exclusivamente mediante el RPC seguro de abajo.
-- ============================================================

REVOKE UPDATE
ON public.profiles
FROM authenticated;

GRANT UPDATE (full_name)
ON public.profiles
TO authenticated;


-- ============================================================
-- 2. POLÍTICA DE UPDATE DE PROFILES
-- ============================================================

DROP POLICY IF EXISTS u_own_profile
ON public.profiles;

CREATE POLICY u_own_profile
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
)
WITH CHECK (
  id = auth.uid()
  OR public.is_admin()
);


-- ============================================================
-- 3. RPC ADMINISTRATIVO
-- ============================================================
--
-- Cambia en una sola transacción:
--   - rol
--   - sucursal
--   - estado activo/inactivo
--
-- _role:
--   owner
--   admin
--   manager
--   cashier
--   staff
--
-- _branch_id:
--   UUID de sucursal
--   NULL = sin sucursal
--
-- _is_active:
--   true / false
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_user_access(
  _user_id uuid,
  _role public.app_role,
  _branch_id uuid DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_is_owner boolean;
  target_has_owner_role boolean;
BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- SOLO OWNER / ADMIN
  -- ----------------------------------------------------------

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;


  -- ----------------------------------------------------------
  -- EL USUARIO DESTINO DEBE EXISTIR
  -- ----------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
  ) THEN
    RAISE EXCEPTION 'user profile not found';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR SUCURSAL
  -- ----------------------------------------------------------

  IF _branch_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.branches b
       WHERE b.id = _branch_id
         AND b.is_active = true
     )
  THEN
    RAISE EXCEPTION 'branch not found or inactive';
  END IF;


  -- ----------------------------------------------------------
  -- DETERMINAR SI QUIEN LLAMA ES OWNER
  -- ----------------------------------------------------------

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = caller_id
      AND ur.role = 'owner'
  )
  INTO caller_is_owner;


  -- ----------------------------------------------------------
  -- DETERMINAR SI EL DESTINO ES OWNER
  -- ----------------------------------------------------------

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'owner'
  )
  INTO target_has_owner_role;


  -- ----------------------------------------------------------
  -- ADMIN NO PUEDE MODIFICAR OWNER
  -- ----------------------------------------------------------

  IF target_has_owner_role
     AND NOT caller_is_owner
  THEN
    RAISE EXCEPTION 'only owner can modify an owner';
  END IF;


  -- ----------------------------------------------------------
  -- NADIE PUEDE QUITAR EL OWNER DEL ÚLTIMO OWNER
  -- ----------------------------------------------------------

  IF target_has_owner_role
     AND _role <> 'owner'
  THEN
    IF (
      SELECT count(*)
      FROM public.user_roles ur
      JOIN public.profiles p
        ON p.id = ur.user_id
      WHERE ur.role = 'owner'
        AND p.is_active = true
    ) <= 1
    THEN
      RAISE EXCEPTION 'cannot remove the last active owner';
    END IF;
  END IF;


  -- ----------------------------------------------------------
  -- NADIE PUEDE DESACTIVAR EL ÚLTIMO OWNER ACTIVO
  -- ----------------------------------------------------------

  IF target_has_owner_role
     AND NOT _is_active
  THEN
    IF (
      SELECT count(*)
      FROM public.user_roles ur
      JOIN public.profiles p
        ON p.id = ur.user_id
      WHERE ur.role = 'owner'
        AND p.is_active = true
    ) <= 1
    THEN
      RAISE EXCEPTION 'cannot deactivate the last active owner';
    END IF;
  END IF;


  -- ----------------------------------------------------------
  -- NO PERMITIR QUE UN OWNER SE AUTO-DESACTIVE
  -- ----------------------------------------------------------

  IF caller_id = _user_id
     AND target_has_owner_role
     AND NOT _is_active
  THEN
    RAISE EXCEPTION 'owner cannot deactivate itself';
  END IF;


  -- ----------------------------------------------------------
  -- ACTUALIZAR PERFIL
  -- ----------------------------------------------------------

  UPDATE public.profiles
  SET
    branch_id = _branch_id,
    is_active = _is_active,
    updated_at = now()
  WHERE id = _user_id;


  -- ----------------------------------------------------------
  -- REEMPLAZAR ROL
  -- ----------------------------------------------------------

  DELETE FROM public.user_roles
  WHERE user_id = _user_id;


  INSERT INTO public.user_roles (
    user_id,
    role
  )
  VALUES (
    _user_id,
    _role
  );

END;
$$;


-- ============================================================
-- 4. PROTEGER EJECUCIÓN DEL RPC
-- ============================================================

REVOKE ALL
ON FUNCTION public.admin_set_user_access(
  uuid,
  public.app_role,
  uuid,
  boolean
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_user_access(
  uuid,
  public.app_role,
  uuid,
  boolean
)
TO authenticated, service_role;


-- ============================================================
-- 5. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS profiles_active_role_idx
ON public.profiles (is_active, id);

CREATE INDEX IF NOT EXISTS user_roles_role_user_idx
ON public.user_roles (role, user_id);


COMMIT;