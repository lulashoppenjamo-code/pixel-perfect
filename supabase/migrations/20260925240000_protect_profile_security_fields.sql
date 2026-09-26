BEGIN;

DROP POLICY IF EXISTS
u_own_profile
ON public.profiles;

CREATE POLICY
u_own_profile
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

CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND OLD.id = auth.uid()
  THEN
    NEW.branch_id := OLD.branch_id;
    NEW.is_active := OLD.is_active;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
trg_protect_profile_security_fields
ON public.profiles;

CREATE TRIGGER
trg_protect_profile_security_fields
BEFORE UPDATE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_security_fields();

REVOKE ALL
ON FUNCTION public.protect_profile_security_fields()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.protect_profile_security_fields()
TO authenticated, service_role;

COMMIT;