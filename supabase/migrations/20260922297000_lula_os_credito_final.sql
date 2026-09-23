-- ============================================================
-- LULA OS — CRÉDITO / CLIENTES DEFINITIVO
-- ============================================================
-- Corrige:
-- 1. Saldo real de crédito.
-- 2. Abonos sin exceder el saldo.
-- 3. Abonos en efectivo ligados a caja.
-- 4. Abonos con tarjeta/transferencia fuera de caja.
-- 5. Historial de abonos.
-- 6. Seguridad mediante RPC.
--
-- NO elimina clientes.
-- NO elimina ventas.
-- NO elimina abonos existentes.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
credit_payments_customer_created_idx
ON public.credit_payments (
  customer_id,
  created_at DESC
);

CREATE INDEX IF NOT EXISTS
credit_payments_sale_idx
ON public.credit_payments (
  sale_id
);

CREATE INDEX IF NOT EXISTS
credit_payments_branch_idx
ON public.credit_payments (
  branch_id
);


-- ============================================================
-- 2. SALDO REAL DEL CLIENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_balance(
  _customer_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE((
      SELECT SUM(
        CASE
          WHEN s.status = 'completed'
            THEN s.total

          WHEN s.status = 'partially_refunded'
            THEN s.total

          ELSE 0
        END
      )
      FROM public.sales s
      WHERE s.customer_id = _customer_id
        AND s.payment_method = 'credit'
        AND s.status IN (
          'completed',
          'partially_refunded'
        )
    ), 0)

    -

    COALESCE((
      SELECT SUM(cp.amount)
      FROM public.credit_payments cp
      WHERE cp.customer_id = _customer_id
    ), 0),

    0
  );
$$;


REVOKE ALL
ON FUNCTION public.get_customer_balance(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_balance(uuid)
TO authenticated;


-- ============================================================
-- 3. RESUMEN COMPLETO DE CRÉDITO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_credit_summary(
  _customer_id uuid
)
RETURNS TABLE (
  customer_id uuid,
  credit_sales numeric,
  payments numeric,
  balance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _customer_id,

    COALESCE((
      SELECT SUM(s.total)
      FROM public.sales s
      WHERE s.customer_id = _customer_id
        AND s.payment_method = 'credit'
        AND s.status IN (
          'completed',
          'partially_refunded'
        )
    ), 0),

    COALESCE((
      SELECT SUM(cp.amount)
      FROM public.credit_payments cp
      WHERE cp.customer_id = _customer_id
    ), 0),

    public.get_customer_balance(
      _customer_id
    );
$$;


REVOKE ALL
ON FUNCTION public.get_customer_credit_summary(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(uuid)
TO authenticated;


-- ============================================================
-- 4. REGISTRAR ABONO
-- ============================================================
--
-- Toda operación de crédito pasa por aquí.
--
-- Efectivo:
--   requiere caja abierta.
--   genera movimiento de caja.
--
-- Tarjeta / transferencia:
--   no aumenta el efectivo de caja.
--
-- No permite pagar más que el saldo.
-- ============================================================

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

  v_payment public.credit_payments;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- VALIDACIONES
  -- ==========================================================

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION
      'customer is required';
  END IF;


  IF _amount IS NULL
     OR _amount <= 0
  THEN
    RAISE EXCEPTION
      'payment amount must be greater than zero';
  END IF;


  IF _payment_method NOT IN (
    'cash',
    'card',
    'transfer'
  )
  THEN
    RAISE EXCEPTION
      'invalid credit payment method';
  END IF;


  -- ==========================================================
  -- VERIFICAR CLIENTE
  -- ==========================================================

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE id = _customer_id
  )
  THEN
    RAISE EXCEPTION
      'customer not found';
  END IF;


  -- ==========================================================
  -- SALDO ACTUAL
  -- ==========================================================

  v_balance :=
    public.get_customer_balance(
      _customer_id
    );


  IF v_balance <= 0 THEN
    RAISE EXCEPTION
      'customer has no outstanding balance';
  END IF;


  IF _amount > v_balance THEN
    RAISE EXCEPTION
      'payment exceeds customer balance. Balance: %',
      ROUND(v_balance, 2);
  END IF;


  -- ==========================================================
  -- SUCURSAL
  -- ==========================================================

  v_branch_id :=
    _branch_id;


  IF v_branch_id IS NULL THEN

    SELECT branch_id
    INTO v_branch_id
    FROM public.profiles
    WHERE id = uid;

  END IF;


  -- ==========================================================
  -- EFECTIVO
  -- ==========================================================

  IF _payment_method = 'cash' THEN

    v_session_id :=
      _cash_session_id;

    -- Si frontend no envía sesión, buscar caja abierta.
    IF v_session_id IS NULL THEN

      SELECT cs.id
      INTO v_session_id

      FROM public.cash_sessions cs

      WHERE cs.status = 'open'

        AND (
          v_branch_id IS NULL
          OR cs.branch_id = v_branch_id
        )

      ORDER BY cs.opened_at DESC

      LIMIT 1;

    END IF;


    IF v_session_id IS NULL THEN
      RAISE EXCEPTION
        'no open cash session for credit payment';
    END IF;


    -- Verificar que realmente esté abierta.
    IF NOT EXISTS (
      SELECT 1
      FROM public.cash_sessions
      WHERE id = v_session_id
        AND status = 'open'
    )
    THEN
      RAISE EXCEPTION
        'cash session is not open';
    END IF;

  ELSE

    -- Tarjeta / transferencia no requieren caja.
    v_session_id := NULL;

  END IF;


  -- ==========================================================
  -- REGISTRAR ABONO
  -- ==========================================================

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
    _payment_method,
    NULLIF(TRIM(_notes), ''),
    v_branch_id,
    uid
  )
  RETURNING *
  INTO v_payment;


  -- ==========================================================
  -- SI ES EFECTIVO, REGISTRAR EN CAJA
  -- ==========================================================

  IF _payment_method = 'cash' THEN

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


-- ============================================================
-- 5. HISTORIAL DE CRÉDITO DEL CLIENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_credit_history(
  _customer_id uuid
)
RETURNS TABLE (
  movement_type text,
  movement_id uuid,
  movement_date timestamptz,
  amount numeric,
  payment_method text,
  notes text,
  sale_folio text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'credit_sale'::text,
    s.id,
    s.created_at,
    s.total,
    s.payment_method::text,
    NULL::text,
    s.folio
  FROM public.sales s
  WHERE s.customer_id = _customer_id
    AND s.payment_method = 'credit'
    AND s.status IN (
      'completed',
      'partially_refunded'
    )

  UNION ALL

  SELECT
    'payment'::text,
    cp.id,
    cp.created_at,
    cp.amount,
    cp.payment_method,
    cp.notes,
    NULL::text
  FROM public.credit_payments cp
  WHERE cp.customer_id = _customer_id

  ORDER BY movement_date DESC;
$$;


REVOKE ALL
ON FUNCTION public.get_customer_credit_history(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_history(uuid)
TO authenticated;


-- ============================================================
-- 6. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  uuid,
  text
)
IS
'LULA OS: registra abonos de crédito. Los abonos en efectivo se reflejan automáticamente en la caja abierta.';


COMMENT ON FUNCTION public.get_customer_credit_history(uuid)
IS
'LULA OS: historial cronológico de ventas a crédito y abonos del cliente.';


COMMIT;