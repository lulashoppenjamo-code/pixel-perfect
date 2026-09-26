BEGIN;

DROP POLICY IF EXISTS
replenishment_requests_read
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_read
ON public.replenishment_requests
FOR SELECT
TO authenticated
USING (
  public.is_manager()
  OR (
    branch_id IS NOT NULL
    AND public.can_access_branch(branch_id)
  )
  OR (
    branch_id IS NULL
    AND requested_by = auth.uid()
  )
);

DROP POLICY IF EXISTS
replenishment_requests_create
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_create
ON public.replenishment_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND (
    branch_id IS NULL
    OR public.can_access_branch(branch_id)
  )
);

DROP POLICY IF EXISTS
replenishment_requests_update
ON public.replenishment_requests;

CREATE POLICY
replenishment_requests_update
ON public.replenishment_requests
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
  OR (
    requested_by = auth.uid()
    AND status = 'pending'
    AND (
      branch_id IS NULL
      OR public.can_access_branch(branch_id)
    )
  )
)
WITH CHECK (
  public.is_manager()
  OR (
    requested_by = auth.uid()
    AND status = 'pending'
    AND (
      branch_id IS NULL
      OR public.can_access_branch(branch_id)
    )
  )
);

COMMIT;