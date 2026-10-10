-- ============================================================
-- LULA SHOP OS
-- FIX DEFINITIVO — BACKEND DE COLABORADORES
-- Migration: 20261005020000
--
-- OBJETIVO:
-- Asegurar que la base de datos desplegada tenga las estructuras
-- necesarias para:
--
--   administrador
--        ↓
--   admin-create-user
--        ↓
--   Supabase Auth
--        ↓
--   profiles
--        ↓
--   admin_set_user_access()
--        ↓
--   admin_set_collaborator_pin()
--
-- NO modifica:
-- - ventas
-- - create_sale()
-- - inventario
-- - stock compartido
-- - cashier_id
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTENSIÓN CRIPTOGRÁFICA
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. CREDENCIALES PIN
-- ============================================================

CREATE TABLE IF NOT EXISTS public.collaborator_pin_credentials (
  user_id uuid PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  pin_hash text NOT NULL,

  failed_attempts integer NOT NULL DEFAULT 0,

  locked_until timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT collaborator_pin_credentials_failed_attempts_check
    CHECK (failed_attempts >= 0)
);


-- ============================================================
-- 3. DISPOSITIVOS AUTORIZADOS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.authorized_pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  device_name text NOT NULL DEFAULT 'Tablet Lula Shop',

  device_secret_hash text NOT NULL UNIQUE,

  branch_id uuid NULL
    REFERENCES public.branches(id)
    ON DELETE SET NULL,

  authorized_by uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE RESTRICT,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),

  last_used_at timestamptz NULL,

  updated_at timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- 4. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_authorized_pos_devices_active
ON public.authorized_pos_devices(is_active);

CREATE INDEX IF NOT EXISTS idx_authorized_pos_devices_branch
ON public.authorized_pos_devices(branch_id);

CREATE INDEX IF NOT EXISTS idx_authorized_pos_devices_authorized_by
ON public.authorized_pos_devices(authorized_by);


-- ============================================================
-- 5. RLS
-- ============================================================

ALTER TABLE public.collaborator_pin_credentials
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.authorized_pos_devices
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 6. POLÍTICAS
-- ============================================================

DROP POLICY IF EXISTS collaborator_pin_credentials_select_own
ON public.collaborator_pin_credentials;

CREATE POLICY collaborator_pin_credentials_select_own
ON public.collaborator_pin_credentials
FOR SELECT
TO authenticated
USING (false);


DROP POLICY IF EXISTS authorized_pos_devices_select_own_admin
ON public.authorized_pos_devices;

CREATE POLICY authorized_pos_devices_select_own_admin
ON public.authorized_pos_devices
FOR SELECT
TO authenticated
USING (
  authorized_by = auth.uid()
  OR public.has_permission('usuarios.manage')
);


-- ============================================================
-- 7. CONFIGURAR PIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_set_collaborator_pin(
  _user_id uuid,
  _pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pin text := trim(COALESCE(_pin, ''));
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = _user_id
      AND p.is_active = true
      AND ur.role <> 'owner'
  ) THEN
    RAISE EXCEPTION 'active collaborator not found';
  END IF;

  IF v_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must contain exactly 4 digits';
  END IF;

  INSERT INTO public.collaborator_pin_credentials (
    user_id,
    pin_hash,
    failed_attempts,
    locked_until,
    updated_at
  )
  VALUES (
    _user_id,
    crypt(v_pin, gen_salt('bf', 12)),
    0,
    NULL,
    now()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    pin_hash = EXCLUDED.pin_hash,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now();

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
TO authenticated;


-- ============================================================
-- 8. AUTORIZAR DISPOSITIVO
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_authorize_pos_device(
  _device_name text,
  _device_secret text,
  _branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_secret text := trim(COALESCE(_device_secret, ''));
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;

  IF length(v_secret) < 32 THEN
    RAISE EXCEPTION 'device secret is invalid';
  END IF;

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

  INSERT INTO public.authorized_pos_devices (
    device_name,
    device_secret_hash,
    branch_id,
    authorized_by,
    is_active
  )
  VALUES (
    COALESCE(
      NULLIF(trim(_device_name), ''),
      'Tablet Lula Shop'
    ),
    encode(
      digest(v_secret, 'sha256'),
      'hex'
    ),
    _branch_id,
    auth.uid(),
    true
  )
  RETURNING id
  INTO v_id;

  RETURN v_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
TO authenticated;


-- ============================================================
-- 9. REVOCAR DISPOSITIVO
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_revoke_pos_device(
  _device_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;

  UPDATE public.authorized_pos_devices
  SET
    is_active = false,
    updated_at = now()
  WHERE id = _device_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_revoke_pos_device(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_revoke_pos_device(uuid)
TO authenticated;


-- ============================================================
-- 10. VERIFICAR PIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_collaborator_pin(
  _device_secret text,
  _user_id uuid,
  _pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device public.authorized_pos_devices;
  v_credentials public.collaborator_pin_credentials;
  v_profile public.profiles;
  v_pin text := trim(COALESCE(_pin, ''));
  v_device_hash text;
BEGIN

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  IF v_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  v_device_hash :=
    encode(
      digest(
        trim(COALESCE(_device_secret, '')),
        'sha256'
      ),
      'hex'
    );

  SELECT *
  INTO v_device
  FROM public.authorized_pos_devices
  WHERE device_secret_hash = v_device_hash
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = _user_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner must use administrator login';
  END IF;

  SELECT *
  INTO v_credentials
  FROM public.collaborator_pin_credentials
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIN not configured';
  END IF;

  IF v_credentials.locked_until IS NOT NULL
     AND v_credentials.locked_until > now()
  THEN
    RAISE EXCEPTION 'PIN temporarily locked';
  END IF;

  IF crypt(
       v_pin,
       v_credentials.pin_hash
     ) <> v_credentials.pin_hash
  THEN

    UPDATE public.collaborator_pin_credentials
    SET
      failed_attempts = failed_attempts + 1,
      locked_until =
        CASE
          WHEN failed_attempts + 1 >= 5
          THEN now() + interval '5 minutes'
          ELSE NULL
        END,
      updated_at = now()
    WHERE user_id = _user_id;

    RAISE EXCEPTION 'invalid credentials';
  END IF;

  UPDATE public.collaborator_pin_credentials
  SET
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
  WHERE user_id = _user_id;

  UPDATE public.authorized_pos_devices
  SET
    last_used_at = now(),
    updated_at = now()
  WHERE id = v_device.id;

  RETURN _user_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.verify_collaborator_pin(text, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.verify_collaborator_pin(text, uuid, text)
TO service_role;


-- ============================================================
-- 11. LISTA DE COLABORADORES PARA LOGIN POR PIN
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_collaborators_for_pin_login(
  _device_secret text
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  branch_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device_hash text;
BEGIN

  IF length(trim(COALESCE(_device_secret, ''))) < 32 THEN
    RAISE EXCEPTION 'device not authorized';
  END IF;

  v_device_hash :=
    encode(
      digest(
        trim(_device_secret),
        'sha256'
      ),
      'hex'
    );

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorized_pos_devices d
    WHERE d.device_secret_hash = v_device_hash
      AND d.is_active = true
  ) THEN
    RAISE EXCEPTION 'device not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.branch_id
  FROM public.profiles p
  WHERE p.is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.collaborator_pin_credentials c
      WHERE c.user_id = p.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role <> 'owner'
    )
  ORDER BY lower(COALESCE(p.full_name, ''));

END;
$$;


REVOKE ALL
ON FUNCTION public.get_collaborators_for_pin_login(text)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 12. FIN
-- ============================================================

COMMIT;