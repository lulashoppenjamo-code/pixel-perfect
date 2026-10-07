-- ============================================================
-- LULA SHOP OS
-- FIX DEFINITIVO — admin_set_collaborator_pin
-- Migration: 20261007100000
--
-- CORRIGE:
--   Could not find the function
--   public.admin_set_collaborator_pin(...)
--   in the schema cache
--
-- IMPORTANTE:
-- - NO modifica ventas
-- - NO modifica create_sale()
-- - NO modifica inventario
-- - NO modifica stock compartido
-- - NO modifica caja
-- - NO modifica POS
-- - NO modifica cashier_id
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ASEGURAR pgcrypto
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 2. ASEGURAR TABLA DE PIN
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
-- 3. RLS
-- ============================================================

ALTER TABLE public.collaborator_pin_credentials
ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 4. POLÍTICA DE SEGURIDAD
-- ============================================================

DROP POLICY IF EXISTS collaborator_pin_credentials_select_own
ON public.collaborator_pin_credentials;

CREATE POLICY collaborator_pin_credentials_select_own
ON public.collaborator_pin_credentials
FOR SELECT
TO authenticated
USING (false);


-- ============================================================
-- 5. ELIMINAR CUALQUIER DEFINICIÓN ANTERIOR CON LA FIRMA
--    EXACTA QUE NECESITA admin-create-user
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_set_collaborator_pin(uuid, text);


-- ============================================================
-- 6. CREAR LA FUNCIÓN CORRECTA
--
-- FIRMA EXACTA:
--
-- public.admin_set_collaborator_pin(
--   _user_id uuid,
--   _pin text
-- )
-- ============================================================

CREATE FUNCTION public.admin_set_collaborator_pin(
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
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- PERMISO ADMINISTRATIVO
  -- ----------------------------------------------------------

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
  END IF;


  -- ----------------------------------------------------------
  -- USUARIO OBLIGATORIO
  -- ----------------------------------------------------------

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;


  -- ----------------------------------------------------------
  -- VERIFICAR QUE SEA COLABORADOR ACTIVO
  -- Y QUE NO SEA OWNER
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
  -- PIN EXACTAMENTE DE 4 DÍGITOS
  -- ----------------------------------------------------------

  IF v_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must contain exactly 4 digits';
  END IF;


  -- ----------------------------------------------------------
  -- GUARDAR ÚNICAMENTE HASH BCRYPT
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
-- 7. PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_set_collaborator_pin(uuid, text)
TO service_role;


-- ============================================================
-- 8. FORZAR RECARGA DEL SCHEMA CACHE DE POSTGREST
--
-- Esto es importante porque el error actual habla
-- específicamente del "schema cache".
-- ============================================================

NOTIFY pgrst, 'reload schema';


COMMIT;