-- ============================================================
-- LULA OS
-- CORRECCIÓN FINAL DE CANCELACIONES + CIERRE DE CAJA
-- 2026-09-25
--
-- OBJETIVO:
--
-- Una venta cancelada después de haber sido cobrada:
--
--   1. Sale del estado válido de venta.
--   2. Devuelve el inventario.
--   3. Devuelve a caja la parte efectivamente cobrada
--      en efectivo mediante un withdrawal.
--   4. El cierre de caja debe considerar el pago original
--      y después descontar el withdrawal.
--
-- EJEMPLO:
--
-- Venta en efectivo:       $100
-- Cancelación:             -$100
-- Efectivo esperado final: $0
--
-- Para venta mixta:
--
-- Venta total:             $100
-- Efectivo:                 $60
-- Tarjeta:                  $40
-- Cancelación:             -$60
-- Efectivo esperado final: $0
--
-- NO CREA inventarios por sucursal.
-- NO separa shared_inventory.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. CIERRE DE CAJA
--
-- IMPORTANTE:
--
-- Las ventas canceladas también deben contabilizarse en los
-- pagos originales porque el dinero sí entró al cajón antes
-- de cancelar la venta.
--
-- Después, cancel_sale() registra un withdrawal por la parte
-- en efectivo.
--
-- De esta manera:
--
--   pago original +100
--   withdrawal     -100
--   resultado         0
--
-- Esto evita el doble descuento.
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
  -- BLOQUEAR CAJA
  -- ==========================================================

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


  -- ==========================================================
  -- VALIDAR SUCURSAL
  -- ==========================================================

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


  -- ==========================================================
  -- PERMISO PARA CERRAR
  -- ==========================================================

  IF s.opened_by <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- EFECTIVO DE VENTAS
  --
  -- Se incluyen:
  --
  -- completed
  -- cancelled
  -- partially_refunded
  -- refunded
  --
  -- ¿Por qué cancelled?
  --
  -- Porque el pago original sí entró a caja.
  -- cancel_sale() crea después el withdrawal correspondiente.
  --
  -- Ejemplo:
  --
  -- venta       +100
  -- cancelación -100
  -- total          0
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
  WHERE sp.payment_method =
    'cash'::public.payment_method
    AND sl.cash_session_id = s.id
    AND sl.branch_id = s.branch_id
    AND sl.status IN (
      'completed'::public.sale_status,
      'cancelled'::public.sale_status,
      'partially_refunded'::public.sale_status,
      'refunded'::public.sale_status
    );


  v_cash_sales :=
    ROUND(
      COALESCE(
        v_cash_sales,
        0
      ),
      2
    );


  -- ==========================================================
  -- MOVIMIENTOS DE CAJA
  --
  -- Incluye:
  --
  -- depósitos manuales
  -- retiros manuales
  -- reembolsos
  -- cancelaciones
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(
        CASE

          WHEN cm.type =
            'deposit'::public.cash_movement_type
          THEN
            cm.amount

          WHEN cm.type =
            'withdrawal'::public.cash_movement_type
          THEN
            -cm.amount

          ELSE
            0

        END
      ),
      0
    )
  INTO v_cash_movements
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = s.id;


  v_cash_movements :=
    ROUND(
      COALESCE(
        v_cash_movements,
        0
      ),
      2
    );


  -- ==========================================================
  -- GASTOS PAGADOS EN EFECTIVO
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(e.amount),
      0
    )
  INTO v_cash_expenses
  FROM public.expenses e
  WHERE e.cash_session_id = s.id
    AND e.payment_method =
      'cash';


  v_cash_expenses :=
    ROUND(
      COALESCE(
        v_cash_expenses,
        0
      ),
      2
    );


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


  v_expected :=
    ROUND(
      v_expected,
      2
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
      v_expected,

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


-- ============================================================
-- 2. PERMISOS
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
-- 3. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
IS
'LULA OS: cierre de caja reconciliando ventas en efectivo, cancelaciones, devoluciones, movimientos manuales y gastos en efectivo sin doble descuento.';


COMMIT;