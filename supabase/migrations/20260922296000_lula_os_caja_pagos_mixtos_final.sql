-- ============================================================
-- LULA OS — CAJA + PAGOS MIXTOS DEFINITIVOS
-- ============================================================
-- Corrige:
-- 1) POS "mixed": convierte el pago mixto en efectivo + tarjeta.
-- 2) Cierre de caja: toma el efectivo real desde sale_payments.
--
-- NO elimina datos.
-- NO cambia firmas usadas por el frontend.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. NORMALIZAR PAGOS MIXTOS DEL POS
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_mixed_sale_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_cash numeric(12,2);
  v_card numeric(12,2);
BEGIN

  IF NEW.payment_method <> 'mixed'::public.payment_method THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'sale not found for mixed payment';
  END IF;

  v_cash := GREATEST(
    LEAST(
      COALESCE(v_sale.cash_received, 0),
      NEW.amount
    ),
    0
  );

  v_card := ROUND(
    NEW.amount - v_cash,
    2
  );

  -- EFECTIVO
  IF v_cash > 0 THEN

    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      reference,
      created_by
    )
    VALUES (
      NEW.sale_id,
      'cash'::public.payment_method,
      v_cash,
      NEW.reference,
      COALESCE(
        NEW.created_by,
        auth.uid()
      )
    );

  END IF;

  -- TARJETA
  IF v_card > 0 THEN

    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      reference,
      created_by
    )
    VALUES (
      NEW.sale_id,
      'card'::public.payment_method,
      v_card,
      NEW.reference,
      COALESCE(
        NEW.created_by,
        auth.uid()
      )
    );

  END IF;

  -- Evita que se conserve el registro artificial "mixed".
  RETURN NULL;

END;
$$;


DROP TRIGGER IF EXISTS
sale_payments_normalize_mixed
ON public.sale_payments;


CREATE TRIGGER
sale_payments_normalize_mixed
BEFORE INSERT
ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION
public.normalize_mixed_sale_payment();


REVOKE ALL
ON FUNCTION public.normalize_mixed_sale_payment()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.normalize_mixed_sale_payment()
TO authenticated, service_role;


-- ============================================================
-- 2. CIERRE DE CAJA DEFINITIVO
-- ============================================================

CREATE OR REPLACE FUNCTION public.close_cash_session(
  _session_id uuid,
  _closing_amount numeric
)
RETURNS public.cash_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

  uid uuid := auth.uid();

  s public.cash_sessions;

  v_cash_sales numeric(12,2) := 0;

  v_cash_movements numeric(12,2) := 0;

  v_cash_expenses numeric(12,2) := 0;

  v_expected numeric(12,2) := 0;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- VALIDAR EFECTIVO CONTADO
  -- ==========================================================

  IF _closing_amount IS NULL
     OR _closing_amount < 0
  THEN

    RAISE EXCEPTION
      'closing amount must be zero or greater';

  END IF;


  -- ==========================================================
  -- BLOQUEAR SESIÓN
  -- ==========================================================

  SELECT *
  INTO s
  FROM public.cash_sessions
  WHERE id = _session_id
    AND status = 'open'
  FOR UPDATE;


  IF s.id IS NULL THEN

    RAISE EXCEPTION
      'session not found or closed';

  END IF;


  -- ==========================================================
  -- PERMISOS
  -- ==========================================================

  IF s.opened_by <> uid
     AND NOT public.is_manager()
  THEN

    RAISE EXCEPTION
      'not allowed';

  END IF;


  -- ==========================================================
  -- EFECTIVO REAL DE LAS VENTAS
  --
  -- IMPORTANTE:
  -- Aquí ya no se toma sales.total.
  --
  -- Se toma sale_payments:
  --
  -- cash     = efectivo
  -- card     = tarjeta
  -- transfer = transferencia
  --
  -- Por lo tanto los pagos mixtos ya quedan correctamente
  -- separados.
  -- ==========================================================

  SELECT COALESCE(
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

    AND sl.status IN (
      'completed'::public.sale_status,
      'partially_refunded'::public.sale_status
    );


  -- ==========================================================
  -- ENTRADAS / SALIDAS MANUALES
  -- ==========================================================

  SELECT COALESCE(
    SUM(
      CASE

        WHEN type = 'deposit'
        THEN amount

        WHEN type = 'withdrawal'
        THEN -amount

        ELSE 0

      END
    ),
    0
  )

  INTO v_cash_movements

  FROM public.cash_movements

  WHERE cash_session_id =
    s.id;


  -- ==========================================================
  -- GASTOS PAGADOS EN EFECTIVO
  -- ==========================================================

  SELECT COALESCE(
    SUM(amount),
    0
  )

  INTO v_cash_expenses

  FROM public.expenses

  WHERE cash_session_id =
    s.id

    AND payment_method =
      'cash';


  -- ==========================================================
  -- EFECTIVO ESPERADO
  -- ==========================================================

  v_expected :=
      COALESCE(
        s.opening_amount,
        0
      )

    + COALESCE(
        v_cash_sales,
        0
      )

    + COALESCE(
        v_cash_movements,
        0
      )

    - COALESCE(
        v_cash_expenses,
        0
      );


  -- ==========================================================
  -- CERRAR CAJA
  -- ==========================================================

  UPDATE public.cash_sessions

  SET

    status =
      'closed',

    closed_by =
      uid,

    closed_at =
      now(),

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

  WHERE id =
    _session_id

  RETURNING *
  INTO s;


  RETURN s;

END;
$$;


-- ============================================================
-- 3. SEGURIDAD
-- ============================================================

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
TO authenticated, service_role;


-- ============================================================
-- 4. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
sale_payments_sale_method_idx
ON public.sale_payments (
  sale_id,
  payment_method
);


CREATE INDEX IF NOT EXISTS
sales_cash_session_status_idx
ON public.sales (
  cash_session_id,
  status
);


-- ============================================================
-- 5. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
IS
'LULA OS: cierre de caja basado en pagos reales de efectivo, pagos mixtos normalizados, movimientos manuales y gastos en efectivo.';


COMMENT ON FUNCTION public.normalize_mixed_sale_payment()
IS
'LULA OS: convierte el pago mixto del POS en partidas reales de efectivo y tarjeta.';


COMMIT;