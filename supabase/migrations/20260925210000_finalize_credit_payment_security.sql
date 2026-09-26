-- ============================================================
-- LULA OS — FINAL CREDIT PAYMENT SECURITY
-- 2026-09-25
--
-- Última versión de register_credit_payment()
--
-- Conserva:
-- 1. Protección contra abonos concurrentes.
-- 2. Validación real del saldo.
-- 3. Seguridad por sucursal.
-- 4. Validación de caja para efectivo.
-- 5. Registro automático del movimiento de caja.
--
-- NO modifica tablas.
-- NO modifica inventario.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_credit_payment(
  _customer_id uuid,
  _amount numeric,
  _payment_method text DEFAULT 'cash',
  _branch_id uuid DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.credit_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();

  v_balance numeric(12,2);
  v_branch_id uuid;
  v_session_id uuid;
  v_session_branch uuid;
  v_payment public.credit_payments;
  v_customer_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'customer is required';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION
      'payment amount must be greater than zero';
  END IF;

  IF LOWER(TRIM(COALESCE(_payment_method, '')))
     NOT IN ('cash', 'card', 'transfer')
  THEN
    RAISE EXCEPTION
      'invalid credit payment method';
  END IF;

  /*
   * BLOQUEAR CLIENTE
   *
   * Evita que dos abonos simultáneos utilicen
   * el mismo saldo disponible.
   */
  SELECT id
  INTO v_customer_id
  FROM public.customers
  WHERE id = _customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found';
  END IF;

  /*
   * El saldo se calcula DESPUÉS del bloqueo.
   */
  v_balance :=
    public.get_customer_balance(
      _customer_id
    );

  IF v_balance <= 0 THEN
    RAISE EXCEPTION
      'customer has no outstanding balance';
  END IF;

  IF ROUND(_amount, 2) >
     ROUND(v_balance, 2)
  THEN
    RAISE EXCEPTION
      'payment exceeds customer balance. Balance: %',
      ROUND(v_balance, 2);
  END IF;

  /*
   * Determinar sucursal.
   */
  v_branch_id := _branch_id;

  IF v_branch_id IS NULL THEN

    SELECT p.branch_id
    INTO v_branch_id
    FROM public.profiles p
    WHERE p.id = uid;

  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;

  /*
   * El usuario debe tener acceso a la sucursal.
   */
  IF NOT public.can_access_branch(
    v_branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      v_branch_id;
  END IF;

  /*
   * EFECTIVO
   *
   * Requiere caja abierta de la misma sucursal.
   */
  IF LOWER(TRIM(_payment_method)) = 'cash' THEN

    v_session_id := _cash_session_id;

    /*
     * Si el frontend no envía caja,
     * buscar automáticamente la caja abierta
     * de la sucursal.
     */
    IF v_session_id IS NULL THEN

      SELECT cs.id
      INTO v_session_id

      FROM public.cash_sessions cs

      WHERE cs.status = 'open'
        AND cs.branch_id = v_branch_id

      ORDER BY cs.opened_at DESC

      LIMIT 1;

    END IF;

    IF v_session_id IS NULL THEN
      RAISE EXCEPTION
        'no open cash session for credit payment';
    END IF;

    /*
     * Confirmar que la caja siga abierta.
     */
    SELECT cs.branch_id
    INTO v_session_branch

    FROM public.cash_sessions cs

    WHERE cs.id = v_session_id
      AND cs.status = 'open';

    IF v_session_branch IS NULL THEN
      RAISE EXCEPTION
        'cash session is not open';
    END IF;

    /*
     * La caja debe pertenecer a la misma sucursal.
     */
    IF v_session_branch <> v_branch_id THEN
      RAISE EXCEPTION
        'cash session belongs to another branch';
    END IF;

    IF NOT public.can_access_branch(
      v_session_branch
    )
    THEN
      RAISE EXCEPTION
        'not allowed for cash session branch';
    END IF;

  ELSE

    /*
     * Tarjeta y transferencia no afectan efectivo.
     */
    v_session_id := NULL;

  END IF;

  /*
   * REGISTRAR ABONO
   */
  INSERT INTO public.credit_payments (
    customer_id,
    amount,
    payment_method,
    notes,
    branch_id,
    created_by
  )
  VALUES (
    _customer_id,
    ROUND(_amount, 2),
    LOWER(TRIM(_payment_method)),
    NULLIF(
      TRIM(COALESCE(_notes, '')),
      ''
    ),
    v_branch_id,
    uid
  )
  RETURNING *
  INTO v_payment;

  /*
   * ABONO EN EFECTIVO → ENTRADA DE CAJA
   */
  IF LOWER(TRIM(_payment_method)) = 'cash' THEN

    INSERT INTO public.cash_movements (
      cash_session_id,
      type,
      amount,
      reason,
      created_by
    )
    VALUES (
      v_session_id,
      'deposit',
      ROUND(_amount, 2),
      'Abono de crédito — cliente ' ||
        _customer_id::text,
      uid
    );

  END IF;

  RETURN v_payment;

END;
$$;

REVOKE ALL
ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  uuid,
  text
)
TO authenticated;

COMMENT ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  uuid,
  text
)
IS
'LULA OS final: abonos de crédito con bloqueo concurrente del cliente, validación de sucursal y caja, y movimiento automático de efectivo.';

COMMIT;