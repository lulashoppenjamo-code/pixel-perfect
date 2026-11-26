-- PENDING: apply through lov_database--migration in a coordinated release.
-- The currently published client still uses two arguments; do not apply this
-- signature change independently of the matching client. No cash rows are changed
-- when this DDL is applied. The existing column is neither recreated nor changed.
-- Verified live on 2026-11-26: closing_denominations jsonb nullable; function owner
-- postgres; EXECUTE only postgres, authenticated, service_role; no DB dependents.

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_sessions'
      AND column_name = 'closing_denominations' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'cash_sessions.closing_denominations jsonb must already exist';
  END IF;
  IF to_regprocedure('public.close_cash_session(uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'verified two-argument close function is missing; reverify before applying';
  END IF;
  IF md5(pg_get_functiondef('public.close_cash_session(uuid,numeric)'::regprocedure))
      <> '364b2e96367d81f784246fb1879f98fc' THEN
    RAISE EXCEPTION 'close function changed since verification; do not replace without rechecking';
  END IF;
  IF to_regprocedure('public.close_cash_session(uuid,numeric,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'three-argument close function already exists; reverify before applying';
  END IF;
END;
$guard$;

-- RESTRICT (the default) refuses removal if database dependencies have appeared.
DROP FUNCTION public.close_cash_session(uuid, numeric);

CREATE OR REPLACE FUNCTION public.close_cash_session(
  _session_id uuid,
  _closing_amount numeric,
  _closing_denominations jsonb
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  s public.cash_sessions;
  v_user_branch uuid;
  v_expected numeric(12,2);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('caja.close') THEN
    RAISE EXCEPTION 'not authorized: caja.close';
  END IF;

  IF _closing_amount IS NULL OR _closing_amount < 0 THEN
    RAISE EXCEPTION 'invalid closing amount';
  END IF;

  IF jsonb_typeof(COALESCE(_closing_denominations, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid closing denominations: expected JSON object';
  END IF;

  SELECT *
  INTO s
  FROM public.cash_sessions
  WHERE id = _session_id
    AND status = 'open'
  FOR UPDATE;

  IF s.id IS NULL THEN
    RAISE EXCEPTION 'session not found or closed';
  END IF;

  SELECT p.branch_id
  INTO v_user_branch
  FROM public.profiles p
  WHERE p.id = uid;

  IF NOT public.is_manager()
     AND v_user_branch IS NOT NULL
     AND v_user_branch <> s.branch_id
  THEN
    RAISE EXCEPTION 'not allowed for branch %', s.branch_id;
  END IF;

  IF s.opened_by <> uid AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT ROUND(
    COALESCE(s.opening_amount, 0)
    + COALESCE((
        SELECT SUM(total)
        FROM public.sales
        WHERE cash_session_id = s.id
          AND payment_method = 'cash'
          AND status IN ('completed', 'partially_refunded', 'refunded')
      ), 0)
    + COALESCE((
        SELECT SUM(COALESCE(cash_received, 0))
        FROM public.sales
        WHERE cash_session_id = s.id
          AND payment_method = 'mixed'
          AND status IN ('completed', 'partially_refunded', 'refunded')
      ), 0)
    + COALESCE((
        SELECT SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END)
        FROM public.cash_movements
        WHERE cash_session_id = s.id
      ), 0)
    - COALESCE((
        SELECT SUM(amount)
        FROM public.expenses
        WHERE cash_session_id = s.id
          AND payment_method = 'cash'
      ), 0),
    2
  )
  INTO v_expected;

  UPDATE public.cash_sessions
  SET status = 'closed',
      closed_by = uid,
      closed_at = now(),
      closing_amount = ROUND(_closing_amount, 2),
      closing_denominations = COALESCE(_closing_denominations, '{}'::jsonb),
      expected_amount = v_expected,
      difference = ROUND(_closing_amount - v_expected, 2),
      updated_at = now()
  WHERE id = _session_id
  RETURNING * INTO s;

  RETURN s;
END;
$function$;

ALTER FUNCTION public.close_cash_session(uuid, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_cash_session(uuid, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric, jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';