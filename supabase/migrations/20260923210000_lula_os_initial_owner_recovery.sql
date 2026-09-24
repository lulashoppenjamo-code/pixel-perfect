-- ============================================================
-- LULA OS
-- Recuperación segura del propietario inicial
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_profile(_full_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Crear perfil si todavía no existe.
  INSERT INTO public.profiles (id, full_name)
  VALUES (uid, _full_name)
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  -- Si este usuario ya tiene rol, no modificarlo.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = uid
  ) THEN
    RETURN;
  END IF;

  -- Si todavía NO existe ningún propietario/admin,
  -- este usuario puede convertirse en propietario inicial.
  --
  -- Esto NO promociona usuarios si ya existe un propietario
  -- o administrador.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE role IN ('owner', 'admin')
  ) THEN

    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, 'owner');

  ELSE

    -- Usuarios nuevos normales.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, 'staff');

  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_profile(text) TO authenticated;