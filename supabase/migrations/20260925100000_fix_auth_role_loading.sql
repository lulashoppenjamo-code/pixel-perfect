/*
  LULA OS
  Reparación definitiva de carga de roles.

  Problema:
  Las migraciones anteriores contienen intentos de
  permisos sobre has_role() con firmas distintas.

  Solución:
  Crear una única RPC segura que obtiene exclusivamente
  los roles del usuario autenticado mediante auth.uid().
*/

CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS public.app_role[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    ARRAY_AGG(ur.role ORDER BY ur.role::text),
    ARRAY[]::public.app_role[]
  )
  FROM public.user_roles ur
  INNER JOIN public.profiles p
    ON p.id = ur.user_id
  WHERE ur.user_id = auth.uid()
    AND p.id = auth.uid()
    AND p.is_active = true;
$$;


/*
  Solo usuarios autenticados pueden ejecutarla.
*/
REVOKE ALL
ON FUNCTION public.get_my_roles()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_my_roles()
TO authenticated, service_role;


/*
  Reparar definitivamente los permisos de has_role()
  usando la firma REAL de la función.
*/
REVOKE ALL
ON FUNCTION public.has_role(uuid, public.app_role)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_role(uuid, public.app_role)
TO authenticated, service_role;


/*
  Asegurar que el usuario pueda leer su propio rol.
*/
DROP POLICY IF EXISTS r_user_roles
ON public.user_roles;

CREATE POLICY r_user_roles
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin()
);


/*
  Asegurar que el usuario pueda leer su propio perfil.
*/
DROP POLICY IF EXISTS r_profiles
ON public.profiles;

CREATE POLICY r_profiles
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
);


/*
  Confirmación de integridad para el propietario
  actualmente configurado.
*/
UPDATE public.profiles
SET is_active = true
WHERE id IN (
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'owner'
);