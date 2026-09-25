-- ============================================================
-- LULA SHOP OS
-- Recuperación segura del acceso del primer usuario
-- ============================================================
--
-- OBJETIVO:
-- Si la base todavía no tiene ningún owner/admin y existe
-- exactamente un usuario en profiles, ese usuario se convierte
-- en owner y queda activo.
--
-- Esto corrige el caso en que el usuario puede autenticarse
-- pero la aplicación muestra:
--
-- "Tu rol actual no incluye permiso para ver esta página"
--
-- SEGURIDAD:
-- - Solo actúa si existe EXACTAMENTE un perfil.
-- - Solo actúa si todavía NO existe owner ni admin.
-- - No modifica usuarios adicionales.
-- - No modifica inventario.
-- - No modifica ventas.
-- - No modifica caja.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_profile_count INTEGER;
  v_owner_count INTEGER;
  v_admin_count INTEGER;
  v_user_id UUID;
BEGIN

  -- ----------------------------------------------------------
  -- Contar perfiles existentes
  -- ----------------------------------------------------------

  SELECT COUNT(*)
  INTO v_profile_count
  FROM public.profiles;

  -- ----------------------------------------------------------
  -- Comprobar si ya existe owner
  -- ----------------------------------------------------------

  SELECT COUNT(*)
  INTO v_owner_count
  FROM public.user_roles
  WHERE role = 'owner';

  -- ----------------------------------------------------------
  -- Comprobar si ya existe admin
  -- ----------------------------------------------------------

  SELECT COUNT(*)
  INTO v_admin_count
  FROM public.user_roles
  WHERE role = 'admin';

  -- ----------------------------------------------------------
  -- Solo ejecutar bootstrap cuando:
  --
  -- 1. Hay exactamente un perfil.
  -- 2. No hay owner.
  -- 3. No hay admin.
  -- ----------------------------------------------------------

  IF v_profile_count = 1
     AND v_owner_count = 0
     AND v_admin_count = 0
  THEN

    SELECT id
    INTO v_user_id
    FROM public.profiles
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN

      -- Activar al primer usuario.
      UPDATE public.profiles
      SET is_active = TRUE
      WHERE id = v_user_id;

      -- Crear rol owner si todavía no existe.
      INSERT INTO public.user_roles (
        user_id,
        role
      )
      VALUES (
        v_user_id,
        'owner'
      )
      ON CONFLICT (user_id, role)
      DO NOTHING;

      RAISE NOTICE
        'Bootstrap de acceso completado para usuario %.',
        v_user_id;

    END IF;

  ELSE

    RAISE NOTICE
      'Bootstrap omitido. profiles=%, owners=%, admins=%.',
      v_profile_count,
      v_owner_count,
      v_admin_count;

  END IF;

END $$;

COMMIT;