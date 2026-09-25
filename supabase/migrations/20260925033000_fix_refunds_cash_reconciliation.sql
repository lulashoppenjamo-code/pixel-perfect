-- ============================================================
-- LULA OS
-- DEVOLUCIONES + RECONCILIACIÓN DE EFECTIVO
-- 2026-09-25
--
-- OBJETIVOS
--
-- 1. Mantener shared_inventory como inventario único.
-- 2. Calcular correctamente el importe devuelto.
-- 3. Determinar la parte de efectivo de una devolución.
-- 4. Registrar el reembolso de efectivo como salida de caja.
-- 5. Soportar devoluciones parciales y totales.
-- 6. Usar la caja original si continúa abierta.
-- 7. Si la caja original ya cerró, usar la caja abierta
--    actual de la misma sucursal.
-- 8. Evitar doble conteo en el cierre de caja.
--
-- NO CREA inventarios por sucursal.
-- NO modifica shared_inventory para separarlo por sucursal.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. DEVOLUCIONES
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_sale(
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();

  v_sale public.sales;
  v_item jsonb;
  v_sale_item public.sale_items;

  v_requested_qty numeric;
  v_remaining_qty numeric;

  v_item_refund numeric(12,2);
  v_refund_total numeric(12,2) := 0;

  v_cash_paid numeric(12,2) := 0;
  v_cash_refund numeric(12,2) := 0;

  v_cash_session_id uuid;
  v_cash_session_branch uuid;

  v_all_returned boolean := true;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ==========================================================
  -- VALIDAR ITEMS
  -- ==========================================================

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0
  THEN
    RAISE EXCEPTION
      'refund items are required';
  END IF;


  -- ==========================================================
  -- BLOQUEAR VENTA
  -- ==========================================================

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = _sale_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'sale not found';
  END IF;


  -- ==========================================================
  -- VALIDAR SUCURSAL
  -- ==========================================================

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


  -- ==========================================================
  -- VALIDAR ESTADO
  -- ==========================================================

  IF v_sale.status NOT IN (
    'completed',
    'partially_refunded'
  )
  THEN
    RAISE EXCEPTION
      'sale cannot be refunded in its current status';
  END IF;


  -- ==========================================================
  -- PERMISO
  -- ==========================================================

  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- OBTENER EFECTIVO ORIGINAL
  --
  -- No usamos únicamente sales.payment_method.
  --
  -- sale_payments contiene el reparto real:
  --
  -- cash   = efectivo
  -- card   = tarjeta
  -- transfer = transferencia
  -- credit = crédito
  --
  -- Para mixed, cash representa únicamente la parte
  -- que realmente entró al cajón.
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(sp.amount),
      0
    )
  INTO v_cash_paid
  FROM public.sale_payments sp
  WHERE sp.sale_id = _sale_id
    AND sp.payment_method =
      'cash'::public.payment_method;


  v_cash_paid :=
    ROUND(
      COALESCE(v_cash_paid, 0),
      2
    );


  -- ==========================================================
  -- PROCESAR DEVOLUCIONES
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    IF NOT (v_item ? 'sale_item_id') THEN
      RAISE EXCEPTION
        'sale_item_id is required';
    END IF;


    v_requested_qty :=
      COALESCE(
        (v_item ->> 'quantity')::numeric,
        0
      );


    IF v_requested_qty <= 0 THEN
      RAISE EXCEPTION
        'refund quantity must be greater than zero';
    END IF;


    -- --------------------------------------------------------
    -- BLOQUEAR ITEM
    -- --------------------------------------------------------

    SELECT *
    INTO v_sale_item
    FROM public.sale_items
    WHERE id =
      (v_item ->> 'sale_item_id')::uuid
      AND sale_id = _sale_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'sale item does not belong to sale';
    END IF;


    -- --------------------------------------------------------
    -- CANTIDAD DISPONIBLE
    -- --------------------------------------------------------

    v_remaining_qty :=
      v_sale_item.quantity
      -
      COALESCE(
        v_sale_item.returned_quantity,
        0
      );


    IF v_requested_qty > v_remaining_qty THEN
      RAISE EXCEPTION
        'refund quantity exceeds remaining quantity for sale item';
    END IF;


    -- --------------------------------------------------------
    -- VALIDAR INVENTARIO
    -- --------------------------------------------------------

    IF v_sale_item.product_id IS NULL THEN
      RAISE EXCEPTION
        'cannot restore inventory for sale item without product';
    END IF;


    -- --------------------------------------------------------
    -- IMPORTE DE ESTA DEVOLUCIÓN
    --
    -- sale_items.total ya contiene el descuento de la línea.
    -- Por eso se prorratea por cantidad.
    -- --------------------------------------------------------

    IF v_sale_item.quantity <= 0 THEN
      RAISE EXCEPTION
        'sale item quantity must be greater than zero';
    END IF;


    v_item_refund :=
      ROUND(
        (
          COALESCE(
            v_sale_item.total,
            0
          )
          /
          v_sale_item.quantity
        )
        *
        v_requested_qty,
        2
      );


    IF v_item_refund < 0 THEN
      RAISE EXCEPTION
        'refund amount cannot be negative';
    END IF;


    v_refund_total :=
      v_refund_total
      +
      v_item_refund;


    -- --------------------------------------------------------
    -- MARCAR CANTIDAD DEVUELTA
    -- --------------------------------------------------------

    UPDATE public.sale_items
    SET
      returned_quantity =
        COALESCE(
          returned_quantity,
          0
        )
        +
        v_requested_qty
    WHERE id = v_sale_item.id;


    -- --------------------------------------------------------
    -- DEVOLVER STOCK CENTRAL
    -- --------------------------------------------------------

    PERFORM public.return_shared_stock(
      v_sale_item.product_id,
      v_sale_item.variant_id,
      v_requested_qty
    );


    -- --------------------------------------------------------
    -- MOVIMIENTO DE INVENTARIO
    -- --------------------------------------------------------

    INSERT INTO public.inventory_movements (
      branch_id,
      product_id,
      variant_id,
      type,
      quantity,
      reference_id,
      reference_type,
      notes,
      created_by
    )
    VALUES (
      v_sale.branch_id,
      v_sale_item.product_id,
      v_sale_item.variant_id,
      'return'::public.movement_type,
      v_requested_qty,
      _sale_id,
      'sale_refund',
      COALESCE(
        NULLIF(
          TRIM(_reason),
          ''
        ),
        'Devolución de venta'
      ),
      uid
    );

  END LOOP;


  v_refund_total :=
    ROUND(
      v_refund_total,
      2
    );


  -- ==========================================================
  -- DETERMINAR QUÉ PARTE DEL REEMBOLSO ES EFECTIVO
  --
  -- Si la venta fue:
  --
  -- $1,000 total
  -- $600 efectivo
  -- $400 tarjeta
  --
  -- y se devuelve $500:
  --
  -- efectivo devuelto = $300
  --
  -- Esto evita retirar de caja dinero que originalmente
  -- nunca entró al cajón.
  -- ==========================================================

  IF v_cash_paid > 0
     AND v_sale.total > 0
  THEN

    v_cash_refund :=
      ROUND(
        v_refund_total
        *
        (
          v_cash_paid
          /
          ROUND(
            v_sale.total,
            2
          )
        ),
        2
      );

  ELSE

    v_cash_refund := 0;

  END IF;


  -- ==========================================================
  -- LIMITES DE SEGURIDAD
  -- ==========================================================

  IF v_cash_refund < 0 THEN
    v_cash_refund := 0;
  END IF;


  IF v_cash_refund > v_cash_paid THEN
    v_cash_refund := v_cash_paid;
  END IF;


  -- ==========================================================
  -- BUSCAR CAJA PARA EL REEMBOLSO
  --
  -- PRIORIDAD:
  --
  -- 1. Caja original de la venta si está abierta.
  -- 2. Caja abierta actual de la misma sucursal.
  --
  -- Si no existe caja abierta y se necesita devolver efectivo,
  -- se rechaza la operación completa.
  -- ==========================================================

  IF v_cash_refund > 0 THEN

    IF v_sale.cash_session_id IS NOT NULL THEN

      SELECT
        cs.id,
        cs.branch_id
      INTO
        v_cash_session_id,
        v_cash_session_branch
      FROM public.cash_sessions cs
      WHERE cs.id =
        v_sale.cash_session_id
        AND cs.status = 'open'
      FOR UPDATE;

    END IF;


    IF v_cash_session_id IS NULL THEN

      SELECT
        cs.id,
        cs.branch_id
      INTO
        v_cash_session_id,
        v_cash_session_branch
      FROM public.cash_sessions cs
      WHERE cs.branch_id =
        v_sale.branch_id
        AND cs.status = 'open'
      ORDER BY
        cs.opened_at DESC
      LIMIT 1
      FOR UPDATE;

    END IF;


    IF v_cash_session_id IS NULL THEN
      RAISE EXCEPTION
        'no open cash session available for cash refund';
    END IF;


    IF v_cash_session_branch <>
       v_sale.branch_id
    THEN
      RAISE EXCEPTION
        'cash refund session belongs to another branch';
    END IF;


    -- --------------------------------------------------------
    -- SALIDA DE CAJA
    -- --------------------------------------------------------

    INSERT INTO public.cash_movements (
      cash_session_id,
      type,
      amount,
      reason,
      created_by
    )
    VALUES (
      v_cash_session_id,
      'withdrawal'::public.cash_movement_type,
      v_cash_refund,
      CONCAT(
        'Reembolso de devolución · venta #',
        v_sale.folio
      ),
      uid
    );

  END IF;


  -- ==========================================================
  -- DETERMINAR ESTADO FINAL
  -- ==========================================================

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.sale_items si
    WHERE si.sale_id = _sale_id
      AND COALESCE(
        si.returned_quantity,
        0
      ) < si.quantity
  )
  INTO v_all_returned;


  -- ==========================================================
  -- ACTUALIZAR VENTA
  -- ==========================================================

  UPDATE public.sales
  SET
    status =
      CASE
        WHEN v_all_returned
        THEN 'refunded'::public.sale_status

        ELSE
          'partially_refunded'::public.sale_status
      END,

    notes =
      CASE

        WHEN _reason IS NULL
          OR TRIM(_reason) = ''
        THEN notes

        WHEN notes IS NULL
          OR TRIM(notes) = ''
        THEN
          'Devolución: '
          || TRIM(_reason)

        ELSE
          notes
          || ' | Devolución: '
          || TRIM(_reason)

      END,

    updated_at = now()

  WHERE id = _sale_id

  RETURNING *
  INTO v_sale;


  RETURN v_sale;

END;
$$;


-- ============================================================
-- PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
TO authenticated, service_role;


COMMENT ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
IS
'LULA OS: devolución de mercancía con prorrateo de efectivo y salida automática de caja para la parte efectivamente reembolsada en efectivo.';


-- ============================================================
-- 2. CIERRE DE CAJA
--
-- IMPORTANTE:
--
-- Una devolución crea una salida de caja.
--
-- Por eso las ventas reembolsadas COMPLETAMENTE deben seguir
-- contando su pago original y después descontarse mediante el
-- movimiento de devolución.
--
-- Las ventas canceladas no se cuentan porque cancel_sale no
-- registra actualmente un reembolso monetario.
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

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  IF _closing_amount IS NULL
     OR _closing_amount < 0
  THEN
    RAISE EXCEPTION
      'closing amount must be zero or greater';
  END IF;


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


  IF s.opened_by <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- EFECTIVO DE LAS VENTAS
  --
  -- Se cuentan las ventas que tuvieron dinero en caja:
  --
  -- completed
  -- partially_refunded
  -- refunded
  --
  -- Después los reembolsos se descuentan mediante
  -- cash_movements.
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
      'partially_refunded'::public.sale_status,
      'refunded'::public.sale_status
    );


  -- ==========================================================
  -- MOVIMIENTOS DE CAJA
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(
        CASE
          WHEN cm.type =
            'deposit'::public.cash_movement_type
          THEN cm.amount

          WHEN cm.type =
            'withdrawal'::public.cash_movement_type
          THEN -cm.amount

          ELSE 0
        END
      ),
      0
    )
  INTO v_cash_movements
  FROM public.cash_movements cm
  WHERE cm.cash_session_id = s.id;


  -- ==========================================================
  -- GASTOS EN EFECTIVO
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(e.amount),
      0
    )
  INTO v_cash_expenses
  FROM public.expenses e
  WHERE e.cash_session_id = s.id
    AND e.payment_method = 'cash';


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
  -- CERRAR
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
TO authenticated, service_role;


COMMENT ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
IS
'LULA OS: cierre de caja calculado desde pagos de efectivo, devoluciones, movimientos manuales y gastos en efectivo.';


COMMIT;