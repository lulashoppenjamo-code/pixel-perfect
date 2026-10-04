-- ============================================================
-- LULA SHOP OS
-- MULTI-SUCURSAL POR USUARIO
-- ============================================================
--
-- OBJETIVO:
-- Permitir que un usuario pueda estar autorizado en una o varias
-- sucursales sin convertirlo en admin/owner.
--
-- EJEMPLO:
-- Leslie    -> Sucursal 1
-- Esmeralda -> Sucursal 2
-- Ana       -> Sucursal 1 + Sucursal 2
-- Dueños    -> según su perfil/rol actual
--
-- IMPORTANTE:
-- - NO modifica create_sale()
-- - NO modifica shared inventory
-- - NO modifica sales
-- - NO modifica sale_items
-- - NO modifica perfiles existentes
-- - profiles.branch_id continúa siendo la sucursal principal
-- - Esta tabla agrega autorizaciones adicionales.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. TABLA DE SUCURSALES AUTORIZADAS POR USUARIO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_branch_access (
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_branch_access_pkey
    PRIMARY KEY (user_id, branch_id),

  CONSTRAINT user_branch_access_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  CONSTRAINT user_branch_access_branch_id_fkey
    FOREIGN KEY (branch_id)
    REFERENCES public.branches(id)
    ON DELETE CASCADE
);


-- ============================================================
-- 2. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_branch_access_user_id
ON public.user_branch_access(user_id);

CREATE INDEX IF NOT EXISTS idx_user_branch_access_branch_id
ON public.user_branch_access(branch_id);


-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 4. CONSULTAR SUS PROPIAS SUCURSALES
-- ============================================================

DROP POLICY IF EXISTS user_branch_access_select_own
ON public.user_branch_access;

CREATE POLICY user_branch_access_select_own
ON public.user_branch_access
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_manager()
);


-- ============================================================
-- 5. ADMINISTRACIÓN
--
-- No permitimos INSERT/UPDATE/DELETE directo desde el cliente.
-- La administración se hará mediante funciones SECURITY DEFINER.
-- ============================================================

DROP POLICY IF EXISTS user_branch_access_insert
ON public.user_branch_access;

DROP POLICY IF EXISTS user_branch_access_update
ON public.user_branch_access;

DROP POLICY IF EXISTS user_branch_access_delete
ON public.user_branch_access;


-- ============================================================
-- 6. FUNCIÓN: COMPROBAR ACCESO A SUCURSAL
--
-- Mantiene toda la lógica existente:
--
-- owner/admin:
--   acceso global
--
-- manager:
--   su branch_id + asignaciones adicionales
--
-- usuario normal:
--   su branch_id + asignaciones adicionales
--
-- Esto permite que Ana tenga:
--   profiles.branch_id = Sucursal 1
--   user_branch_access = Sucursal 2
--
-- sin convertirla en manager/admin.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_branch(
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND (
          -- OWNER / ADMIN: acceso global
          EXISTS (
            SELECT 1
            FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('owner', 'admin')
          )

          OR

          -- SUCURSAL PRINCIPAL DEL PERFIL
          p.branch_id = _branch_id

          OR

          -- SUCURSAL ADICIONAL AUTORIZADA
          EXISTS (
            SELECT 1
            FROM public.user_branch_access uba
            WHERE uba.user_id = auth.uid()
              AND uba.branch_id = _branch_id
          )
        )
    );
$$;


-- ============================================================
-- 7. PERMISOS DE LA FUNCIÓN
-- ============================================================

REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated;


-- ============================================================
-- 8. FUNCIÓN PARA ASIGNAR SUCURSAL ADICIONAL
--
-- Solo usuarios con permiso de administración de usuarios.
--
-- IMPORTANTE:
-- No modifica profiles.branch_id.
-- Solo agrega una autorización adicional.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_add_user_branch_access(
  _user_id uuid,
  _branch_id uuid
)
RETURNS public.user_branch_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_access public.user_branch_access;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.edit') THEN
    RAISE EXCEPTION 'not authorized: usuarios.edit';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = _user_id
  ) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = _branch_id
  ) THEN
    RAISE EXCEPTION 'branch not found';
  END IF;

  INSERT INTO public.user_branch_access (
    user_id,
    branch_id
  )
  VALUES (
    _user_id,
    _branch_id
  )
  ON CONFLICT (
    user_id,
    branch_id
  )
  DO UPDATE SET
    branch_id = EXCLUDED.branch_id
  RETURNING *
  INTO v_access;

  RETURN v_access;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_add_user_branch_access(uuid, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_add_user_branch_access(uuid, uuid)
TO authenticated;


-- ============================================================
-- 9. FUNCIÓN PARA QUITAR SUCURSAL ADICIONAL
--
-- IMPORTANTE:
-- Si es la sucursal principal del profile, NO se elimina.
-- La sucursal principal sigue siendo profiles.branch_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_remove_user_branch_access(
  _user_id uuid,
  _branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_primary_branch uuid;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.edit') THEN
    RAISE EXCEPTION 'not authorized: usuarios.edit';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;

  SELECT p.branch_id
  INTO v_primary_branch
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  -- Nunca se elimina la sucursal principal
  -- mediante esta función.
  IF v_primary_branch = _branch_id THEN
    RAISE EXCEPTION
      'cannot remove primary branch from profile';
  END IF;

  DELETE FROM public.user_branch_access
  WHERE user_id = _user_id
    AND branch_id = _branch_id;

  RETURN FOUND;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_remove_user_branch_access(uuid, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_remove_user_branch_access(uuid, uuid)
TO authenticated;


-- ============================================================
-- 10. FUNCIÓN PARA CONSULTAR TODAS LAS SUCURSALES AUTORIZADAS
--     DE UN USUARIO
--
-- Sirve para la administración de colaboradores.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_user_branch_access(
  _user_id uuid
)
RETURNS TABLE (
  user_id uuid,
  branch_id uuid,
  branch_name text,
  is_primary boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id AS user_id,
    b.id AS branch_id,
    b.name AS branch_name,
    (p.branch_id = b.id) AS is_primary
  FROM public.profiles p
  JOIN public.branches b
    ON b.id = p.branch_id

  WHERE p.id = _user_id
    AND public.has_permission('usuarios.view')

  UNION

  SELECT
    uba.user_id,
    b.id AS branch_id,
    b.name AS branch_name,
    false AS is_primary
  FROM public.user_branch_access uba
  JOIN public.branches b
    ON b.id = uba.branch_id
  WHERE uba.user_id = _user_id
    AND public.has_permission('usuarios.view')

  ORDER BY is_primary DESC, branch_name;
$$;


REVOKE ALL
ON FUNCTION public.admin_get_user_branch_access(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_get_user_branch_access(uuid)
TO authenticated;


COMMIT;