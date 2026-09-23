-- ============================================================
-- LULA OS — CAJA FINAL
-- ============================================================
-- Corrige:
-- 1. Ventas en efectivo
-- 2. Pagos mixtos
-- 3. Entradas/salidas manuales
-- 4. Gastos pagados en efectivo
-- 5. Cierre y diferencia
--
-- NO elimina tablas.
-- NO elimina datos.
-- Mantiene la firma usada por el frontend.
-- ============================================================

BEGIN;

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
  -- SEGURIDAD
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

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
  -- Ya no usamos únicamente sales.payment_method.
  --
  -- Esto permite:
  --
  -- $500 venta
  -- $300 efectivo
  -- $200 tarjeta
  --
  -- Los $300 sí entran a caja.
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(sp.amount),
      0
    )

  INTO v_cash_sales

  FROM public.sale_payments sp

  INNER JOIN public.sales sl
    ON sl.id = sp.sale_id

  WHERE sp.payment_method = 'cash'

    AND sl.cash_session_id = s.id

    AND sl.status IN (
      'completed',
      'partially_refunded'
    );


  -- ==========================================================
  -- MOVIMIENTOS MANUALES
  -- ==========================================================

  SELECT
    COALESCE(
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

  WHERE cash_session_id = s.id;


  -- ==========================================================
  -- GASTOS PAGADOS EN EFECTIVO
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(amount),
      0
    )

  INTO v_cash_expenses

  FROM public.expenses

  WHERE cash_session_id = s.id

    AND payment_method = 'cash';


  -- ==========================================================
  -- EFECTIVO ESPERADO
  -- ==========================================================

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


  -- ==========================================================
  -- CERRAR CAJA
  -- ==========================================================

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
        _closing_amount - v_expected,
        2
      )

  WHERE id = _session_id

  RETURNING *
  INTO s;


  RETURN s;

END;
$$;


-- ============================================================
-- SEGURIDAD RPC
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
-- DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
IS
'LULA OS: cierre de caja basado en pagos reales de efectivo, pagos mixtos, movimientos manuales y gastos en efectivo.';


COMMIT;