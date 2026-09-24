-- ============================================================
-- LULA OS
-- CORRECCIÓN — ABONOS DE CRÉDITO CONCURRENCY SAFE
-- ============================================================
--
-- OBJETIVO:
--
-- Evitar que dos abonos realizados prácticamente al mismo
-- tiempo puedan utilizar el mismo saldo disponible.
--
-- Ejemplo del problema anterior:
--
-- Saldo: $1,000
--
-- Abono A consulta saldo = $1,000
-- Abono B consulta saldo = $1,000
--
-- Ambos intentan registrar $800.
--
-- Resultado potencial:
-- $1,600 abonados sobre $1,000 de deuda.
--
-- SOLUCIÓN:
--
-- Bloquear la fila del cliente antes de consultar el saldo.
--
-- La segunda operación espera a que termine la primera y después
-- vuelve a calcular el saldo real.
--
-- NO cambia tablas.
-- NO cambia columnas.
-- NO cambia la interfaz.
-- NO elimina abonos.
-- NO elimina clientes.
-- ============================================================

BEGIN;


-- ============================================================
-- REEMPLAZAR RPC DE ABONOS
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

  v_customer_id uuid;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- VALIDACIONES BÁSICAS
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
  -- BLOQUEAR CLIENTE
  -- ==========================================================
  --
  -- Esta es la parte importante.
  --
  -- Mientras esta transacción procesa el abono, otra operación
  -- de abono para el mismo cliente deberá esperar.
  --
  -- Después podrá consultar el saldo actualizado.
  -- ==========================================================

  SELECT id
  INTO v_customer_id
  FROM public.customers
  WHERE id = _customer_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'customer not found';
  END IF;


  -- ==========================================================
  -- CALCULAR SALDO DESPUÉS DEL BLOQUEO
  -- ==========================================================

  v_balance :=
    public.get_customer_balance(
      _customer_id
    );


  IF v_balance <= 0 THEN
    RAISE EXCEPTION
      'customer has no outstanding balance';
  END IF;


  IF ROUND(_amount, 2) > ROUND(v_balance, 2) THEN
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


    -- ========================================================
    -- BUSCAR AUTOMÁTICAMENTE CAJA ABIERTA
    -- ========================================================

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


    -- ========================================================
    -- CONFIRMAR QUE LA CAJA SIGUE ABIERTA
    -- ========================================================

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

    -- ========================================================
    -- TARJETA / TRANSFERENCIA
    -- ========================================================

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
  -- EFECTIVO → MOVIMIENTO DE CAJA
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


  -- ==========================================================
  -- DEVOLVER ABONO REGISTRADO
  -- ==========================================================

  RETURN v_payment;

END;
$$;


-- ============================================================
-- SEGURIDAD
-- ============================================================

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
-- DOCUMENTACIÓN
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
'LULA OS: registra abonos de crédito de forma segura ante operaciones concurrentes. Bloquea al cliente durante la validación del saldo. Los abonos en efectivo se reflejan automáticamente en la caja abierta.';


COMMIT;