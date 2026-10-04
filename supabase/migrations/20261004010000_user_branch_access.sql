-- ============================================================
-- LULA SHOP OS
-- MULTI-SUCURSAL POR USUARIO
-- ============================================================

BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_user_branch_access_user_id
ON public.user_branch_access(user_id);

CREATE INDEX IF NOT EXISTS idx_user_branch_access_branch_id
ON public.user_branch_access(branch_id);

ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS user_branch_access_insert
ON public.user_branch_access;

DROP POLICY IF EXISTS user_branch_access_update
ON public.user_branch_access;

DROP POLICY IF EXISTS user_branch_access_delete
ON public.user_branch_access;

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
              AND ur.role IN ('owner', 'admin')
          )
          OR
          p.branch_id = _branch_id
          OR
          EXISTS (
            SELECT 1
            FROM public.user_branch_access uba
            WHERE uba.user_id = auth.uid()
              AND uba.branch_id = _branch_id
          )
        )
    );
$$;

REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated;

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

  IF NOT public.has_permission('usuarios.manage') THEN
    RAISE EXCEPTION 'not authorized: usuarios.manage';
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
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'branch not found or inactive';
  END IF;

  INSERT INTO public.user_branch_access (
    user_id