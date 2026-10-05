-- ============================================================
-- LULA SHOP OS
-- COLABORADORES — LISTADO SEGURO PARA LOGIN POR PIN
-- Migration: 20261005010000
--
-- OBJETIVO
-- - Permitir que una tablet autorizada consulte los colaboradores
--   disponibles para acceso mediante PIN.
-- - Nunca exponer hashes de PIN.
-- - Nunca permitir acceso desde un dispositivo no autorizado.
-- - Nunca incluir al owner en el login por PIN.
-- - Mantener intactos roles, permisos, ventas e inventario.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. FUNCIÓN
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

  -- ----------------------------------------------------------
  -- Validación básica
  -- ----------------------------------------------------------

  IF length(trim(COALESCE(_device_secret, ''))) < 32 THEN
    RAISE EXCEPTION 'device not authorized';
  END IF;


  -- ----------------------------------------------------------
  -- Convertir secreto del dispositivo a SHA-256.
  -- ----------------------------------------------------------

  v_device_hash :=
    encode(
      digest(
        trim(_device_secret),
        'sha256'
      ),
      'hex'
    );


  -- ----------------------------------------------------------
  -- La tablet debe estar autorizada y activa.
  -- ----------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorized_pos_devices d
    WHERE d.device_secret_hash = v_device_hash
      AND d.is_active = true
  ) THEN
    RAISE EXCEPTION 'device not authorized';
  END IF;


  -- ----------------------------------------------------------
  -- Devolver únicamente colaboradores activos que tengan
  -- configurado un PIN.
  --
  -- El owner queda excluido deliberadamente.
  --
  -- NO se devuelve:
  -- - pin_hash
  -- - failed_attempts
  -- - locked_until
  -- - email interno
  -- - datos sensibles
  -- ----------------------------------------------------------

  RETURN QUERY
  SELECT
    p.id AS user_id,
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

  ORDER BY
    lower(COALESCE(p.full_name, '')) ASC;

END;
$$;


-- ============================================================
-- 2. SEGURIDAD
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_collaborators_for_pin_login(text)
FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- IMPORTANTE:
--
-- No damos GRANT al cliente autenticado.
--
-- El acceso a esta función se realizará desde el flujo de
-- autenticación controlado por la aplicación.
--
-- La función sigue siendo SECURITY DEFINER y valida por sí misma
-- que el dispositivo esté autorizado.
-- ------------------------------------------------------------


COMMIT;