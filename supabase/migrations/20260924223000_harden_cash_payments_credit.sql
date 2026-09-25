-- ============================================================
-- LULA OS
-- HARDEN CASH / PAYMENTS / CREDIT
-- 2026-09-24
--
-- OBJETIVOS
--
-- 1. Pagos mixtos únicamente sobre ventas accesibles.
-- 2. Cierre de caja únicamente dentro de la sucursal permitida.
-- 3. Un usuario no puede cerrar la caja de otra sucursal.
-- 4. Abonos de crédito únicamente dentro de sucursal permitida.
-- 5. El efectivo de un abono debe pertenecer a la misma caja
--    de la sucursal.
-- 6. Historial de crédito no debe filtrar información de otras
--    sucursales a usuarios sin acceso.
--
-- INVENTARIO:
-- No se modifica shared_inventory.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. PAGOS MIXTOS DE UNA VENTA
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_sale_payments(
  _sale_id uuid,
  _payments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  v_sale public.sales;

  v_payment jsonb;

  v_total numeric(12,2) := 0;

  v_amount numeric(12,2);

  v_count integer := 0;

  v_method text;

BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- OBTENER VENTA
  -- ----------------------------------------------------------

  SELECT *
  INTO v_sale

  FROM public.sales

  WHERE id = _sale_id

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale not found';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR SUCURSAL
  -- ----------------------------------------------------------

  IF v_sale.branch_id IS NULL THEN
    RAISE EXCEPTION
      'sale branch is required';
  END IF;


  IF NOT public.can_access_branch(
    v_sale.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for sale branch %',
      v_sale.branch_id;
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR USUARIO
  --
  -- El cajero puede completar sus propias ventas.
  -- Manager/admin/owner pueden operar ventas de su ámbito.
  -- ----------------------------------------------------------

  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ----------------------------------------------------------
  -- ESTADO
  -- ----------------------------------------------------------

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION
      'sale is not active';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR ARRAY
  -- ----------------------------------------------------------

  IF _payments IS NULL
     OR jsonb_typeof(_payments) <> 'array'
     OR jsonb_array_length(_payments) = 0
  THEN
    RAISE EXCEPTION
      'empty payments';
  END IF;


  -- ----------------------------------------------------------
  -- REEMPLAZAR PAGOS EXISTENTES
  -- ----------------------------------------------------------

  DELETE FROM public.sale_payments

  WHERE sale_id = _sale_id;


  -- ----------------------------------------------------------
  -- INSERTAR PAGOS
  -- ----------------------------------------------------------

  FOR v_payment IN
    SELECT *
    FROM jsonb_array_elements(_payments)
  LOOP

    v_amount :=
      COALESCE(
        (v_payment->>'amount')::numeric,
        0
      );


    IF v_amount <= 0 THEN
      RAISE EXCEPTION
        'payment amount must be greater than zero';
    END IF;


    v_method :=
      LOWER(
        TRIM(
          COALESCE(
            v_payment->>'payment_method',
            ''
          )
        )
      );


    IF v_method NOT IN (
      'cash',
      'card',
      'transfer',
      'credit',
      'mixed'
    )
    THEN
      RAISE EXCEPTION
        'invalid payment method';
    END IF;


    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      reference,
      created_by
    )
    VALUES (
      _sale_id,
      v_method::public.payment_method,
      ROUND(v_amount, 2),
      NULLIF(
        TRIM(
          COALESCE(
            v_payment->>'reference',
            ''
          )
        ),
        ''
      ),
      uid
    );


    v_total :=
      v_total + v_amount;


    v_count :=
      v_count + 1;

  END LOOP;


  -- ----------------------------------------------------------
  -- VALIDAR TOTAL
  -- ----------------------------------------------------------

  IF ROUND(v_total, 2)
     <>
     ROUND(v_sale.total, 2)
  THEN

    RAISE EXCEPTION
      'split payments total % but sale total is %',
      ROUND(v_total, 2),
      ROUND(v_sale.total, 2);

  END IF;


  -- ----------------------------------------------------------
  -- ACTUALIZAR MÉTODO PRINCIPAL
  -- ----------------------------------------------------------

  UPDATE public.sales

  SET
    payment_method =
      CASE

        WHEN v_count > 1
        THEN 'mixed'::public.payment_method

        ELSE (
          SELECT sp.payment_method

          FROM public.sale_payments sp

          WHERE sp.sale_id = _sale_id

          ORDER BY sp.created_at ASC NULLS LAST

          LIMIT 1
        )

      END,

    updated_at = now()

  WHERE id = _sale_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.record_sale_payments(
  uuid,
  jsonb
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.record_sale_payments(
  uuid,
  jsonb
)
TO authenticated;


COMMENT ON FUNCTION public.record_sale_payments(
  uuid,
  jsonb
)
IS
'LULA OS: registra pagos individuales y mixtos de una venta únicamente dentro de la sucursal permitida.';


-- ============================================================
-- 2. CERRAR CAJA
-- ============================================================

CREATE OR REPLACE FUNCTION public.close_cash_session(
  _session_id uuid,
  _closing_amount numeric
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  s public.cash_sessions;

  v_cash_sales numeric(12,2) := 0;

  v_cash_movements numeric(12,2) := 0;

  v_cash_expenses numeric(12,2) := 0;

  v_expected numeric(12,2) := 0;

BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- MONTO
  -- ----------------------------------------------------------

  IF _closing_amount IS NULL
     OR _closing_amount < 0
  THEN
    RAISE EXCEPTION
      'closing amount must be zero or greater';
  END IF;


  -- ----------------------------------------------------------
  -- BLOQUEAR SESIÓN
  -- ----------------------------------------------------------

  SELECT *
  INTO s

  FROM public.cash_sessions

  WHERE id = _session_id

    AND status = 'open'

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'session not found or closed';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR SUCURSAL
  -- ----------------------------------------------------------

  IF s.branch_id IS NULL THEN
    RAISE EXCEPTION
      'cash session branch is required';
  END IF;


  IF NOT public.can_access_branch(
    s.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for cash session branch %',
      s.branch_id;
  END IF;


  -- ----------------------------------------------------------
  -- QUIÉN PUEDE CERRAR
  -- ----------------------------------------------------------

  IF s.opened_by <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ----------------------------------------------------------
  -- EFECTIVO DE VENTAS
  --
  -- Se calculan los pagos reales de efectivo.
  -- Esto soporta ventas mixtas.
  -- ----------------------------------------------------------

  SELECT
    COALESCE(
      SUM(sp.amount),
      0
    )

  INTO v_cash_sales

  FROM public.sale_payments sp

  INNER JOIN public.sales sl
    ON sl.id = sp.sale_id

  WHERE sp.payment_method =
    'cash'::public.payment_method

    AND sl.cash_session_id =
      s.id

    AND sl.branch_id =
      s.branch_id

    AND sl.status IN (
      'completed',
      'partially_refunded'
    );


  -- ----------------------------------------------------------
  -- MOVIMIENTOS DE CAJA
  -- ----------------------------------------------------------

  SELECT
    COALESCE(
      SUM(
        CASE

          WHEN cm.type = 'deposit'
          THEN cm.amount

          WHEN cm.type = 'withdrawal'
          THEN -cm.amount

          ELSE 0

        END
      ),
      0
    )

  INTO v_cash_movements

  FROM public.cash_movements cm

  WHERE cm.cash_session_id =
    s.id;


  -- ----------------------------------------------------------
  -- GASTOS EN EFECTIVO
  -- ----------------------------------------------------------

  SELECT
    COALESCE(
      SUM(e.amount),
      0
    )

  INTO v_cash_expenses

  FROM public.expenses e

  WHERE e.cash_session_id =
    s.id

    AND e.payment_method =
      'cash';


  -- ----------------------------------------------------------
  -- EFECTIVO ESPERADO
  -- ----------------------------------------------------------

  v_expected :=
      COALESCE(
        s.opening_amount,
        0
      )

      +

      COALESCE(
        v_cash_sales,
        0
      )

      +

      COALESCE(
        v_cash_movements,
        0
      )

      -

      COALESCE(
        v_cash_expenses,
        0
      );


  -- ----------------------------------------------------------
  -- CERRAR
  -- ----------------------------------------------------------

  UPDATE public.cash_sessions

  SET

    status = 'closed',

    closed_by = uid,

    closed_at = now(),

    closing_amount =
      ROUND(
        _closing_amount,
        2
      ),

    expected_amount =
      ROUND(
        v_expected,
        2
      ),

    difference =
      ROUND(
        _closing_amount
        - v_expected,
        2
      )

  WHERE id = _session_id

  RETURNING *
  INTO s;


  RETURN s;

END;
$$;


REVOKE ALL
ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
TO authenticated;


COMMENT ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
IS
'LULA OS: cierre de caja con validación de sucursal y cálculo de efectivo real incluyendo pagos mixtos.';


-- ============================================================
-- 3. REGISTRAR ABONO DE CRÉDITO
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
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  v_balance numeric(12,2);

  v_branch_id uuid;

  v_session_id uuid;

  v_payment public.credit_payments;

  v_session_branch uuid;

BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDACIONES
  -- ----------------------------------------------------------

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


  IF LOWER(
       TRIM(
         COALESCE(
           _payment_method,
           ''
         )
       )
     )
     NOT IN (
       'cash',
       'card',
       'transfer'
     )
  THEN
    RAISE EXCEPTION
      'invalid credit payment method';
  END IF;


  -- ----------------------------------------------------------
  -- CLIENTE
  -- ----------------------------------------------------------

  IF NOT EXISTS (
    SELECT 1

    FROM public.customers c

    WHERE c.id = _customer_id
  )
  THEN
    RAISE EXCEPTION
      'customer not found';
  END IF;


  -- ----------------------------------------------------------
  -- SALDO
  -- ----------------------------------------------------------

  v_balance :=
    public.get_customer_balance(
      _customer_id
    );


  IF v_balance <= 0 THEN
    RAISE EXCEPTION
      'customer has no outstanding balance';
  END IF;


  IF ROUND(_amount, 2)
     >
     ROUND(v_balance, 2)
  THEN
    RAISE EXCEPTION
      'payment exceeds customer balance. Balance: %',
      ROUND(v_balance, 2);
  END IF;


  -- ----------------------------------------------------------
  -- DETERMINAR SUCURSAL
  -- ----------------------------------------------------------

  v_branch_id :=
    _branch_id;


  IF v_branch_id IS NULL THEN

    SELECT p.branch_id

    INTO v_branch_id

    FROM public.profiles p

    WHERE p.id = uid;

  END IF;


  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION
      'branch is required';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR ACCESO
  -- ----------------------------------------------------------

  IF NOT public.can_access_branch(
    v_branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      v_branch_id;
  END IF;


  -- ----------------------------------------------------------
  -- EFECTIVO
  -- ----------------------------------------------------------

  IF LOWER(
       TRIM(_payment_method)
     ) = 'cash'
  THEN

    v_session_id :=
      _cash_session_id;


    -- --------------------------------------------------------
    -- Si no enviaron sesión, buscar la abierta de la sucursal.
    -- --------------------------------------------------------

    IF v_session_id IS NULL THEN

      SELECT cs.id

      INTO v_session_id

      FROM public.cash_sessions cs

      WHERE cs.status = 'open'

        AND cs.branch_id =
          v_branch_id

      ORDER BY cs.opened_at DESC

      LIMIT 1;

    END IF;


    IF v_session_id IS NULL THEN
      RAISE EXCEPTION
        'no open cash session for credit payment';
    END IF;


    -- --------------------------------------------------------
    -- VALIDAR SESIÓN
    -- --------------------------------------------------------

    SELECT cs.branch_id

    INTO v_session_branch

    FROM public.cash_sessions cs

    WHERE cs.id = v_session_id

      AND cs.status = 'open';


    IF v_session_branch IS NULL THEN
      RAISE EXCEPTION
        'cash session is not open';
    END IF;


    IF v_session_branch <>
       v_branch_id
    THEN
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

    v_session_id :=
      NULL;

  END IF;


  -- ----------------------------------------------------------
  -- INSERTAR ABONO
  -- ----------------------------------------------------------

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

    ROUND(
      _amount,
      2
    ),

    LOWER(
      TRIM(
        _payment_method
      )
    ),

    NULLIF(
      TRIM(
        COALESCE(
          _notes,
          ''
        )
      ),
      ''
    ),

    v_branch_id,

    uid
  )

  RETURNING *
  INTO v_payment;


  -- ----------------------------------------------------------
  -- EFECTIVO A CAJA
  -- ----------------------------------------------------------

  IF LOWER(
       TRIM(_payment_method)
     ) = 'cash'
  THEN

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

      ROUND(
        _amount,
        2
      ),

      'Abono de crédito — cliente '
      || _customer_id::text,

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
'LULA OS: registra abonos de crédito validando sucursal y caja cuando el pago es en efectivo.';


-- ============================================================
-- 4. HISTORIAL DE CRÉDITO
--
-- SECURITY DEFINER:
-- solamente devuelve movimientos de sucursales a las que
-- el usuario tiene acceso.
--
-- Owner/admin:
-- todas las sucursales.
--
-- Manager:
-- su sucursal.
--
-- Otros usuarios:
-- sucursales permitidas por can_access_branch().
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
SET search_path = ''
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

  WHERE s.customer_id =
    _customer_id

    AND s.payment_method =
      'credit'::public.payment_method

    AND s.status IN (
      'completed',
      'partially_refunded'
    )

    AND public.can_access_branch(
      s.branch_id
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

  WHERE cp.customer_id =
    _customer_id

    AND public.can_access_branch(
      cp.branch_id
    )


  ORDER BY movement_date DESC;
$$;


REVOKE ALL
ON FUNCTION public.get_customer_credit_history(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_customer_credit_history(
  uuid
)
TO authenticated;


COMMENT ON FUNCTION public.get_customer_credit_history(
  uuid
)
IS
'LULA OS: historial de crédito filtrado por las sucursales accesibles al usuario.';


-- ============================================================
-- 5. BALANCE DE CLIENTE
--
-- También se limita a ventas y abonos accesibles.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_balance(
  _customer_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT

    COALESCE(
      (
        SELECT SUM(s.total)

        FROM public.sales s

        WHERE s.customer_id =
          _customer_id

          AND s.payment_method =
            'credit'::public.payment_method

          AND s.status IN (
            'completed',
            'partially_refunded'
          )

          AND public.can_access_branch(
            s.branch_id
          )
      ),
      0
    )

    -

    COALESCE(
      (
        SELECT SUM(cp.amount)

        FROM public.credit_payments cp

        WHERE cp.customer_id =
          _customer_id

          AND public.can_access_branch(
            cp.branch_id
          )
      ),
      0
    );
$$;


REVOKE ALL
ON FUNCTION public.get_customer_balance(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_customer_balance(
  uuid
)
TO authenticated;


-- ============================================================
-- 6. RESUMEN DE CRÉDITO
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
SET search_path = ''
AS $$
  SELECT

    _customer_id,

    COALESCE(
      (
        SELECT SUM(s.total)

        FROM public.sales s

        WHERE s.customer_id =
          _customer_id

          AND s.payment_method =
            'credit'::public.payment_method

          AND s.status IN (
            'completed',
            'partially_refunded'
          )

          AND public.can_access_branch(
            s.branch_id
          )
      ),
      0
    ),

    COALESCE(
      (
        SELECT SUM(cp.amount)

        FROM public.credit_payments cp

        WHERE cp.customer_id =
          _customer_id

          AND public.can_access_branch(
            cp.branch_id
          )
      ),
      0
    ),

    public.get_customer_balance(
      _customer_id
    );
$$;


REVOKE ALL
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
TO authenticated;


-- ============================================================
-- 7. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_sale_payments_sale_method_security

ON public.sale_payments(
  sale_id,
  payment_method
);


CREATE INDEX IF NOT EXISTS
idx_cash_movements_session_security

ON public.cash_movements(
  cash_session_id
);


CREATE INDEX IF NOT EXISTS
idx_credit_payments_customer_branch_security

ON public.credit_payments(
  customer_id,
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_cash_sessions_branch_status_security

ON public.cash_sessions(
  branch_id,
  status,
  opened_at DESC
);


COMMIT;