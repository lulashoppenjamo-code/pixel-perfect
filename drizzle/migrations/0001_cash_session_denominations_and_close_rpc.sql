ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS closing_denominations jsonb NULL;

CREATE OR REPLACE FUNCTION public.close_cash_session(
  _session_id uuid,
  _closing_amount numeric
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
      expected_amount = v_expected,
      difference = ROUND(_closing_amount - v_expected, 2),
      updated_at = now()
  WHERE id = _session_id
  RETURNING * INTO s;

  RETURN s;
END;
$function$;