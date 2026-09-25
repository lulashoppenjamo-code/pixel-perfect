-- ============================================================
-- LULA OS
-- SEGURIDAD FINAL — AUTH FUNCTIONS
-- 2026-09-24
--
-- CORRECCIÓN:
-- Las funciones SECURITY DEFINER de autorización deben utilizar
-- search_path vacío para evitar resolución insegura de objetos.
--
-- FUNCIONES:
--   can_access_branch()
--   has_role()
--   is_manager()
--   is_admin()
--   ensure_profile()
--
-- NO:
-- - crea tablas
-- - elimina tablas
-- - cambia firmas
-- - cambia roles
-- - cambia la lógica de sucursales
-- - divide inventario
-- ============================================================

BEGIN;


-- ============================================================
-- 1. ACCESO A SUCURSAL
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
          EXISTS (
            SELECT 1
            FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN (
                'owner',
                'admin'
              )
          )

          OR

          (
            EXISTS (
              SELECT 1
              FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = 'manager'
            )
            AND p.branch_id = _branch_id
          )

          OR

          p.branch_id = _branch_id
        )
    );
$$;


REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated, service_role;


COMMENT ON FUNCTION public.can_access_branch(uuid)
IS
'LULA OS: valida si el usuario activo puede operar una sucursal. Owner/admin pueden operar todas; manager y personal activo operan su sucursal.';


-- ============================================================
-- 2. HAS_ROLE
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    INNER JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = _user_id
      AND p.is_active = true
      AND ur.role = _role
  );
$$;


REVOKE ALL
ON FUNCTION public.has_role(
  uuid,
  public.app_role
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.has_role(
  uuid,
  public.app_role
)
TO authenticated, service_role;


COMMENT ON FUNCTION public.has_role(
  uuid,
  public.app_role
)
IS
'LULA OS: determina si un usuario tiene un rol determinado y su perfil está activo.';


-- ============================================================
-- 3. IS_MANAGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    INNER JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND ur.role IN (
        'owner',
        'admin',
        'manager'
      )
  );
$$;


REVOKE ALL
ON FUNCTION public.is_manager()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.is_manager()
TO authenticated, service_role;


COMMENT ON FUNCTION public.is_manager()
IS
'LULA OS: determina si el usuario autenticado es owner, admin o manager activo.';


-- ============================================================
-- 4. IS_ADMIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    INNER JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND ur.role IN (
        'owner',
        'admin'
      )
  );
$$;


REVOKE ALL
ON FUNCTION public.is_admin()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.is_admin()
TO authenticated, service_role;


COMMENT ON FUNCTION public.is_admin()
IS
'LULA OS: determina si el usuario autenticado es owner o admin activo.';


-- ============================================================
-- 5. ENSURE_PROFILE
-- ============================================================
--
-- PRIMER USUARIO:
--   owner + activo
--
-- USUARIOS POSTERIORES:
--   sin rol automático
--   inactivo
--
-- IMPORTANTE:
-- Un perfil existente NO se reactiva automáticamente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_profile(
  _full_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  existing_profile boolean;

  any_user boolean;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- ¿YA EXISTE PERFIL?
  -- ==========================================================

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = uid
  )
  INTO existing_profile;


  IF existing_profile THEN

    UPDATE public.profiles
    SET
      full_name =
        COALESCE(
          public.profiles.full_name,
          _full_name
        ),
      updated_at = now()
    WHERE id = uid;

    RETURN;

  END IF;


  -- ==========================================================
  -- ¿YA EXISTE ALGÚN USUARIO?
  -- ==========================================================

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
  )
  INTO any_user;


  -- ==========================================================
  -- PRIMER USUARIO
  -- ==========================================================

  IF NOT any_user THEN

    INSERT INTO public.profiles (
      id,
      full_name,
      is_active
    )
    VALUES (
      uid,
      _full_name,
      true
    );


    INSERT INTO public.user_roles (
      user_id,
      role
    )
    VALUES (
      uid,
      'owner'
    );


    RETURN;

  END IF;


  -- ==========================================================
  -- USUARIO NUEVO
  -- ==========================================================
  --
  -- NO recibe automáticamente:
  -- - staff
  -- - cashier
  -- - manager
  -- - admin
  --
  -- Queda pendiente de activación administrativa.
  -- ==========================================================

  INSERT INTO public.profiles (
    id,
    full_name,
    is_active
  )
  VALUES (
    uid,
    _full_name,
    false
  );

END;
$$;


REVOKE ALL
ON FUNCTION public.ensure_profile(text)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.ensure_profile(text)
TO authenticated, service_role;


COMMENT ON FUNCTION public.ensure_profile(text)
IS
'LULA OS: crea el perfil inicial como owner activo; usuarios posteriores quedan inactivos y sin rol hasta autorización administrativa.';


-- ============================================================
-- 6. ÍNDICES DE APOYO
-- ============================================================

CREATE INDEX IF NOT EXISTS
profiles_active_branch_idx
ON public.profiles (
  id,
  is_active,
  branch_id
);


CREATE INDEX IF NOT EXISTS
user_roles_user_role_idx
ON public.user_roles (
  user_id,
  role
);


COMMIT;