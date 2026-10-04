-- ============================================================
-- LULA SHOP OS
-- COLABORADORES — PIN DE 4 DÍGITOS + DISPOSITIVOS AUTORIZADOS
-- Migration: 20261004020000
--
-- OBJETIVO
-- - Permitir autenticación rápida de colaboradores mediante PIN.
-- - Mantener la identidad real de Supabase (auth.uid()).
-- - Autorizar previamente cada tablet/dispositivo.
-- - Nunca almacenar PIN ni secreto de dispositivo en texto plano.
-- - Aplicar bloqueo progresivo ante intentos fallidos.
--
-- IMPORTANTE
-- - Este módulo NO reemplaza Supabase Auth.
-- - Este módulo NO modifica create_sale().
-- - Este módulo NO modifica inventario compartido.
-- - Este módulo NO modifica cashier_id.
-- - Este módulo NO modifica permisos existentes.
-- - El login real con sesión Supabase se implementará después
--   mediante una Edge Function segura.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTENSIÓN CRIPTOGRÁFICA
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. CREDENCIALES PIN DE COLABORADORES
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
-- 3. DISPOSITIVOS POS AUTORIZADOS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.authorized_pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  device_name text NOT NULL DEFAULT 'Tablet Lula Shop',

  /*
   * Nunca se almacena el secreto real del dispositivo.
   * Se almacena únicamente SHA-256.
   */
  device_secret_hash text NOT NULL UNIQUE,

  /*
   * Puede utilizarse como sucursal predeterminada del dispositivo.
   * NO sustituye la selección de sucursal de la aplicación.
   */
  branch_id uuid NULL
    REFERENCES public.branches(id)
    ON DELETE SET NULL,

  /*
   * Usuario que autorizó físicamente el dispositivo.
   */
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

DROP POLICY IF EXISTS authorized_pos_devices_select_own_admin
ON public.authorized_pos_devices;


-- ------------------------------------------------------------
-- PIN
-- ------------------------------------------------------------
--
-- El hash del PIN NO debe ser leído directamente por el cliente.
-- Toda administración/verificación se realiza mediante funciones
-- SECURITY DEFINER controladas.
--

CREATE POLICY collaborator_pin_credentials_select_own
ON public.collaborator_pin_credentials
FOR SELECT
TO authenticated
USING (
  false
);


-- ------------------------------------------------------------
-- DISPOSITIVOS
-- ------------------------------------------------------------
--
-- Administradores con usuarios.manage pueden consultar los
-- dispositivos autorizados.
--
-- El usuario que autorizó el dispositivo también puede verlo.
--

CREATE POLICY authorized_pos_devices_select_own_admin
ON public.authorized_pos_devices
FOR SELECT
TO authenticated
USING (
  authorized_by = auth.uid()
  OR public.has_permission('usuarios.manage')
);


-- ============================================================
-- 7. ADMINISTRAR PIN DE COLABORADOR
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

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- Permiso
  -- ----------------------------------------------------------

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;


  -- ----------------------------------------------------------
  -- Usuario obligatorio
  -- ----------------------------------------------------------

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;


  -- ----------------------------------------------------------
  -- Solo colaboradores activos
  -- Nunca permitir PIN para owner.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- PIN exactamente de 4 dígitos
  -- ----------------------------------------------------------

  IF v_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must contain exactly 4 digits';
  END IF;


  -- ----------------------------------------------------------
  -- Guardar únicamente hash bcrypt.
  -- ----------------------------------------------------------

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


-- ============================================================
-- 8. AUTORIZAR TABLET / DISPOSITIVO
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

  v_secret text :=
    trim(COALESCE(_device_secret, ''));
BEGIN

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- Permiso
  -- ----------------------------------------------------------

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;


  -- ----------------------------------------------------------
  -- El secreto debe tener suficiente entropía.
  -- ----------------------------------------------------------

  IF length(v_secret) < 32 THEN
    RAISE EXCEPTION 'device secret is invalid';
  END IF;


  -- ----------------------------------------------------------
  -- Si se especifica sucursal debe existir y estar activa.
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
  -- Registrar dispositivo.
  -- ----------------------------------------------------------

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

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- Permiso
  -- ----------------------------------------------------------

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;


  -- ----------------------------------------------------------
  -- Revocación lógica.
  -- No se elimina historial.
  -- ----------------------------------------------------------

  UPDATE public.authorized_pos_devices
  SET
    is_active = false,
    updated_at = now()
  WHERE id = _device_id;

END;
$$;


-- ============================================================
-- 10. VERIFICACIÓN INTERNA DEL PIN
-- ============================================================
--
-- IMPORTANTE:
--
-- Esta función NO se expone a anon.
--
-- Será utilizada posteriormente por la Edge Function segura
-- de autenticación rápida.
--
-- La Edge Function será la responsable de:
--
--   dispositivo autorizado
--        ↓
--   verificar PIN
--        ↓
--   obtener user_id real
--        ↓
--   crear/entregar sesión Supabase válida
--
-- Nunca se permitirá que el cliente establezca manualmente
-- auth.uid() ni cashier_id.
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

  v_pin text :=
    trim(COALESCE(_pin, ''));

  v_device_hash text;

BEGIN

  -- ----------------------------------------------------------
  -- Validaciones básicas
  -- ----------------------------------------------------------

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;


  IF v_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;


  -- ----------------------------------------------------------
  -- Hash del secreto del dispositivo.
  -- ----------------------------------------------------------

  v_device_hash :=
    encode(
      digest(
        trim(COALESCE(_device_secret, '')),
        'sha256'
      ),
      'hex'
    );


  -- ----------------------------------------------------------
  -- Verificar dispositivo autorizado.
  -- ----------------------------------------------------------

  SELECT *
  INTO v_device
  FROM public.authorized_pos_devices
  WHERE device_secret_hash = v_device_hash
    AND is_active = true
  LIMIT 1;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;


  -- ----------------------------------------------------------
  -- Verificar colaborador activo.
  -- ----------------------------------------------------------

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = _user_id
    AND is_active = true;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid credentials';
  END IF;


  -- ----------------------------------------------------------
  -- Owner NO puede entrar mediante PIN.
  -- ----------------------------------------------------------

  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'owner'
  ) THEN

    RAISE EXCEPTION
      'owner must use administrator login';

  END IF;


  -- ----------------------------------------------------------
  -- Obtener credenciales.
  -- FOR UPDATE evita carreras durante intentos simultáneos.
  -- ----------------------------------------------------------

  SELECT *
  INTO v_credentials
  FROM public.collaborator_pin_credentials
  WHERE user_id = _user_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIN not configured';
  END IF;


  -- ----------------------------------------------------------
  -- Verificar bloqueo.
  -- ----------------------------------------------------------

  IF v_credentials.locked_until IS NOT NULL
     AND v_credentials.locked_until > now()
  THEN

    RAISE EXCEPTION 'PIN temporarily locked';

  END IF;


  -- ----------------------------------------------------------
  -- Comparación bcrypt.
  -- ----------------------------------------------------------

  IF crypt(
       v_pin,
       v_credentials.pin_hash
     ) <> v_credentials.pin_hash
  THEN

    UPDATE public.collaborator_pin_credentials

    SET
      failed_attempts =
        failed_attempts + 1,

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


  -- ----------------------------------------------------------
  -- PIN correcto.
  -- Reiniciar contador.
  -- ----------------------------------------------------------

  UPDATE public.collaborator_pin_credentials

  SET
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()

  WHERE user_id = _user_id;


  -- ----------------------------------------------------------
  -- Registrar último uso del dispositivo.
  -- ----------------------------------------------------------

  UPDATE public.authorized_pos_devices

  SET
    last_used_at = now(),
    updated_at = now()

  WHERE id = v_device.id;


  -- ----------------------------------------------------------
  -- Devolver identidad real de Supabase.
  -- ----------------------------------------------------------

  RETURN _user_id;

END;
$$;


-- ============================================================
-- 11. SEGURIDAD DE FUNCIONES
-- ============================================================
--
-- Ninguna función administrativa se expone a PUBLIC o anon.
-- La verificación del PIN tampoco se expone directamente
-- al cliente.
-- ============================================================


REVOKE ALL
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
TO authenticated;


REVOKE ALL
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_authorize_pos_device(text, text, uuid)
TO authenticated;


REVOKE ALL
ON FUNCTION public.admin_revoke_pos_device(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_revoke_pos_device(uuid)
TO authenticated;


-- MUY IMPORTANTE:
-- verify_collaborator_pin NO tiene GRANT para anon.
-- La Edge Function segura será la única vía de verificación.

REVOKE ALL
ON FUNCTION public.verify_collaborator_pin(text, uuid, text)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 12. FIN
-- ============================================================

COMMIT;