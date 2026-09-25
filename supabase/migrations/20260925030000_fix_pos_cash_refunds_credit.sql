-- ============================================================
-- LULA OS
-- POS + CAJA + DEVOLUCIONES + CRÉDITO
-- CONSISTENCIA FINANCIERA FINAL
-- 2026-09-25
--
-- OBJETIVOS:
--
-- 1. Cancelar ventas solamente dentro de la caja/turno original.
-- 2. Cancelación:
--    - restaura shared_inventory
--    - registra salida de efectivo cuando corresponde
--    - mantiene auditoría de inventario.
--
-- 3. Devolución:
--    - restaura shared_inventory
--    - calcula devolución proporcional real
--    - registra salida de efectivo cuando corresponde
--    - soporta ventas mixtas.
--
-- 4. Crédito:
--    - una devolución parcial reduce correctamente el saldo.
--    - una devolución total elimina correctamente la deuda.
--
-- 5. Caja:
--    - los pagos mixtos consideran el efectivo realmente recibido.
--
-- INVENTARIO:
--    shared_inventory continúa siendo la única existencia operativa.
--    NO se divide inventario por sucursal.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. CIERRE DE CAJA
--
-- El efectivo esperado se calcula desde:
--
--   apertura
--   + ventas cash
--   + efectivo de ventas mixtas
--   + depósitos
--   - retiros
--   - gastos cash
--   - devoluciones/cancelaciones cash
--
-- Las devoluciones y cancelaciones cash se registran como
-- withdrawals en cash_movements.
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
    RAISE EXCEPTION 'not authenticated';
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


  IF NOT public.can_access_branch(s.branch_id) THEN
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
  -- EFECTIVO REAL DE VENTAS
  --
  -- cash:
  --   se toma el total de la venta.
  --
  -- mixed:
  --   se toma cash_received, que representa únicamente
  --   la parte entregada en efectivo.
  --
  -- No se utiliza sales.total para mixed porque la otra
  -- parte puede ser tarjeta/transferencia.
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(
        CASE
          WHEN s2.payment_method =
            'cash'::public.payment_method
          THEN s2.total

          WHEN s2.payment_method =
            'mixed'::public.payment_method
          THEN COALESCE(
            s2.cash_received,
            0
          )

          ELSE 0
        END
      ),
      0
    )
  INTO v_cash_sales
  FROM public.sales s2
  WHERE s2.cash_session_id = s.id
    AND s2.branch_id = s.branch_id
    AND s2.status IN (
      'completed',
      'partially_refunded'
    );


  -- ==========================================================
  -- MOVIMIENTOS DE CAJA
  -- ==========================================================

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
      COALESCE(s.opening_amount, 0)
    + COALESCE(v_cash_sales, 0)
    + COALESCE(v_cash_movements, 0)
    - COALESCE(v_cash_expenses, 0);


  -- ==========================================================
  -- CERRAR
  -- ==========================================================

  UPDATE public.cash_sessions
  SET
    status = 'closed',
    closed_by = uid,
    closed_at = now(),
    closing_amount = ROUND(
      _closing_amount,
      2
    ),
    expected_amount = ROUND(
      v_expected,
      2
    ),
    difference = ROUND(
      _closing_amount - v_expected,
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


-- ============================================================
-- 2. CANCELACIÓN DE VENTA
--
-- REGLA:
-- La cancelación solamente puede hacerse mientras la caja/turno
-- original de la venta siga abierto.
--
-- Esto evita cancelar ventas históricas de turnos anteriores
-- y modificar artificialmente una caja ya cerrada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_sale(
  _sale_id uuid,
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
  v_cash_session public.cash_sessions;

  r record;

  v_cash_reversal numeric(12,2) := 0;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
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
  -- SUCURSAL
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
  -- ESTADO
  -- ==========================================================

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION
      'sale is already cancelled or refunded';
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
  -- TURNO ORIGINAL
  -- ==========================================================

  IF v_sale.cash_session_id IS NULL THEN
    RAISE EXCEPTION
      'sale has no cash session';
  END IF;


  SELECT *
  INTO v_cash_session
  FROM public.cash_sessions
  WHERE id = v_sale.cash_session_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'original cash session not found';
  END IF;


  IF v_cash_session.status <> 'open' THEN
    RAISE EXCEPTION
      'sale can only be cancelled while its original cash shift is open';
  END IF;


  IF v_cash_session.branch_id IS DISTINCT FROM
     v_sale.branch_id
  THEN
    RAISE EXCEPTION
      'cash session does not belong to sale branch';
  END IF;


  IF NOT public.can_access_branch(
    v_cash_session.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for cash session branch';
  END IF;


  -- ==========================================================
  -- DETERMINAR EFECTIVO A REVERTIR
  --
  -- cash:
  --   total de la venta.
  --
  -- mixed:
  --   solamente cash_received.
  --
  -- card / transfer / credit:
  --   no afecta efectivo.
  -- ==========================================================

  IF v_sale.payment_method =
     'cash'::public.payment_method
  THEN

    v_cash_reversal :=
      ROUND(
        COALESCE(
          v_sale.total,
          0
        ),
        2
      );

  ELSIF v_sale.payment_method =
        'mixed'::public.payment_method
  THEN

    v_cash_reversal :=
      ROUND(
        COALESCE(
          v_sale.cash_received,
          0
        ),
        2
      );

  ELSE

    v_cash_reversal := 0;

  END IF;


  -- ==========================================================
  -- RESTAURAR INVENTARIO COMPARTIDO
  -- ==========================================================

  FOR r IN
    SELECT
      product_id,
      variant_id,
      quantity
    FROM public.sale_items
    WHERE sale_id = _sale_id
  LOOP

    PERFORM public.return_shared_stock(
      r.product_id,
      r.variant_id,
      r.quantity
    );


    UPDATE public.sale_items
    SET
      returned_quantity = quantity
    WHERE sale_id = _sale_id
      AND product_id = r.product_id
      AND variant_id IS NOT DISTINCT FROM
        r.variant_id;


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
      r.product_id,
      r.variant_id,
      'return',
      r.quantity,
      v_sale.id,
      'sale_cancel',
      COALESCE(
        NULLIF(
          TRIM(_reason),
          ''
        ),
        'Cancelación de venta'
      ),
      uid
    );

  END LOOP;


  -- ==========================================================
  -- REVERTIR EFECTIVO
  -- ==========================================================

  IF v_cash_reversal > 0 THEN

    INSERT INTO public.cash_movements (
      cash_session_id,
      type,
      amount,
      reason,
      created_by
    )
    VALUES (
      v_sale.cash_session_id,
      'withdrawal',
      v_cash_reversal,
      'Cancelación de venta #' ||
      v_sale.folio::text ||
      COALESCE(
        ' — ' ||
        NULLIF(
          TRIM(_reason),
          ''
        ),
        ''
      ),
      uid
    );

  END IF;


  -- ==========================================================
  -- CANCELAR
  -- ==========================================================

  UPDATE public.sales
  SET
    status = 'cancelled',

    notes =
      CASE
        WHEN notes IS NULL
             OR TRIM(notes) = ''
        THEN
          'Cancelada: ' ||
          COALESCE(
            NULLIF(
              TRIM(_reason),
              ''
            ),
            'Sin motivo'
          )

        ELSE
          notes ||
          E'\nCancelada: ' ||
          COALESCE(
            NULLIF(
              TRIM(_reason),
              ''
            ),
            'Sin motivo'
          )
      END,

    updated_at = now()

  WHERE id = _sale_id

  RETURNING *
  INTO v_sale;


  RETURN v_sale;

END;
$$;


REVOKE ALL
ON FUNCTION public.cancel_sale(
  uuid,
  text
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.cancel_sale(
  uuid,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 3. DEVOLUCIÓN DE VENTA
--
-- La devolución:
--
--   a) restaura shared_inventory
--   b) calcula valor proporcional de devolución
--   c) devuelve efectivo proporcional cuando corresponde
--   d) mantiene returned_quantity
--   e) cambia el estado de la venta
--
-- Para ventas mixtas:
--   cash_received representa la parte en efectivo.
--   El resto no afecta caja.
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

  v_all_returned boolean := true;

  v_original_items_value numeric(12,2) := 0;
  v_refunded_items_value numeric(12,2) := 0;

  v_refund_total numeric(12,2) := 0;
  v_cash_refund numeric(12,2) := 0;

  v_cash_session public.cash_sessions;

BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


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
  -- SUCURSAL
  -- ==========================================================

  IF NOT public.can_access_branch(
    v_sale.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for sale branch %',
      v_sale.branch_id;
  END IF;


  -- ==========================================================
  -- ESTADO
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
  -- VALOR ORIGINAL DE LOS PRODUCTOS
  --
  -- Se usa la misma base económica almacenada en sale_items.
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(
        (
          si.unit_price *
          si.quantity
        )
        -
        COALESCE(
          si.discount,
          0
        )
      ),
      0
    )
  INTO v_original_items_value
  FROM public.sale_items si
  WHERE si.sale_id = _sale_id;


  IF v_original_items_value <= 0 THEN
    RAISE EXCEPTION
      'sale has no refundable value';
  END IF;


  -- ==========================================================
  -- PROCESAR PRODUCTOS
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    IF NOT (
      v_item ? 'sale_item_id'
    )
    THEN
      RAISE EXCEPTION
        'sale_item_id is required';
    END IF;


    v_requested_qty :=
      COALESCE(
        (
          v_item ->> 'quantity'
        )::numeric,
        0
      );


    IF v_requested_qty <= 0 THEN
      RAISE EXCEPTION
        'refund quantity must be greater than zero';
    END IF;


    SELECT *
    INTO v_sale_item
    FROM public.sale_items
    WHERE id =
      (
        v_item ->
        > 'sale_item_id'
      )::uuid
      AND sale_id = _sale_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'sale item does not belong to sale';
    END IF;


    v_remaining_qty :=
      v_sale_item.quantity
      -
      COALESCE(
        v_sale_item.returned_quantity,
        0
      );


    IF v_requested_qty >
       v_remaining_qty
    THEN
      RAISE EXCEPTION
        'refund quantity exceeds remaining quantity for sale item';
    END IF;


    IF v_sale_item.product_id IS NULL THEN
      RAISE EXCEPTION
        'cannot restore inventory for sale item without product';
    END IF;


    -- Valor de las unidades que se devuelven.
    v_refunded_items_value :=
      v_refunded_items_value
      +
      (
        (
          v_sale_item.unit_price
          *
          v_requested_qty
        )
        -
        (
          COALESCE(
            v_sale_item.discount,
            0
          )
          *
          (
            v_requested_qty /
            NULLIF(
              v_sale_item.quantity,
              0
            )
          )
        )
      );


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


    PERFORM public.return_shared_stock(
      v_sale_item.product_id,
      v_sale_item.variant_id,
      v_requested_qty
    );


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
      'return',
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


  -- ==========================================================
  -- CALCULAR DEVOLUCIÓN MONETARIA
  --
  -- El descuento global de la venta se reparte
  -- proporcionalmente entre los artículos.
  -- ==========================================================

  v_refund_total :=
    ROUND(
      (
        COALESCE(
          v_sale.total,
          0
        )
        *
        v_refunded_items_value
        /
        NULLIF(
          v_original_items_value,
          0
        )
      ),
      2
    );


  v_refund_total :=
    LEAST(
      GREATEST(
        v_refund_total,
        0
      ),
      COALESCE(
        v_sale.total,
        0
      )
    );


  -- ==========================================================
  -- EFECTIVO A DEVOLVER
  -- ==========================================================

  IF v_sale.payment_method =
     'cash'::public.payment_method
  THEN

    v_cash_refund :=
      v_refund_total;

  ELSIF v_sale.payment_method =
        'mixed'::public.payment_method
  THEN

    v_cash_refund :=
      ROUND(
        v_refund_total
        *
        COALESCE(
          v_sale.cash_received,
          0
        )
        /
        NULLIF(
          v_sale.total,
          0
        ),
        2
      );

  ELSE

    v_cash_refund := 0;

  END IF;


  -- ==========================================================
  -- CAJA
  --
  -- Si existe devolución en efectivo, la caja original debe
  -- seguir abierta.
  -- ==========================================================

  IF v_cash_refund > 0 THEN

    IF v_sale.cash_session_id IS NULL THEN
      RAISE EXCEPTION
        'cash refund requires original cash session';
    END IF;


    SELECT *
    INTO v_cash_session
    FROM public.cash_sessions
    WHERE id = v_sale.cash_session_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'original cash session not found';
    END IF;


    IF v_cash_session.status <> 'open' THEN
      RAISE EXCEPTION
        'cash refund requires the original cash shift to be open';
    END IF;


    IF v_cash_session.branch_id IS DISTINCT FROM
       v_sale.branch_id
    THEN
      RAISE EXCEPTION
        'cash session does not belong to sale branch';
    END IF;


    INSERT INTO public.cash_movements (
      cash_session_id,
      type,
      amount,
      reason,
      created_by
    )
    VALUES (
      v_sale.cash_session_id,
      'withdrawal',
      v_cash_refund,
      'Devolución de venta #' ||
      v_sale.folio::text ||
      COALESCE(
        ' — ' ||
        NULLIF(
          TRIM(_reason),
          ''
        ),
        ''
      ),
      uid
    );

  END IF;


  -- ==========================================================
  -- DETERMINAR ESTADO
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


  UPDATE public.sales
  SET
    status =
      CASE
        WHEN v_all_returned
        THEN
          'refunded'::public.sale_status
        ELSE
          'partially_refunded'::public.sale_status
      END,

    notes =
      CASE
        WHEN _reason IS NULL
          OR TRIM(_reason) = ''
        THEN
          notes

        WHEN notes IS NULL
          OR TRIM(notes) = ''
        THEN
          'Devolución: ' ||
          TRIM(_reason)

        ELSE
          notes ||
          ' | Devolución: ' ||
          TRIM(_reason)
      END,

    updated_at = now()

  WHERE id = _sale_id

  RETURNING *
  INTO v_sale;


  RETURN v_sale;

END;
$$;


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


-- ============================================================
-- 4. SALDO DE CRÉDITO CORREGIDO
--
-- Una venta a crédito parcialmente devuelta ya NO debe seguir
-- contando como si el cliente debiera el 100%.
--
-- El importe pendiente de cada venta se calcula:
--
-- venta total
-- menos proporción económica ya devuelta.
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
        SELECT
          SUM(
            CASE
              WHEN s.status = 'refunded'
              THEN 0

              ELSE
                GREATEST(
                  s.total
                  -
                  (
                    s.total
                    *
                    COALESCE(
                      (
                        SELECT
                          SUM(
                            (
                              si.unit_price *
                              COALESCE(
                                si.returned_quantity,
                                0
                              )
                            )
                            -
                            (
                              COALESCE(
                                si.discount,
                                0
                              )
                              *
                              (
                                COALESCE(
                                  si.returned_quantity,
                                  0
                                )
                                /
                                NULLIF(
                                  si.quantity,
                                  0
                                )
                              )
                            )
                          )
                        FROM public.sale_items si
                        WHERE si.sale_id = s.id
                      ),
                      0
                    )
                    /
                    NULLIF(
                      (
                        SELECT
                          SUM(
                            (
                              si2.unit_price *
                              si2.quantity
                            )
                            -
                            COALESCE(
                              si2.discount,
                              0
                            )
                          )
                        FROM public.sale_items si2
                        WHERE si2.sale_id = s.id
                      ),
                      0
                    )
                  ),
                  0
                )
            END
          )
        FROM public.sales s
        WHERE s.customer_id =
          _customer_id
          AND s.payment_method =
            'credit'::public.payment_method
          AND s.status IN (
            'completed',
            'partially_refunded',
            'refunded'
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
        SELECT
          SUM(cp.amount)
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
TO authenticated, service_role;


-- ============================================================
-- 5. RESUMEN DE CRÉDITO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_credit_summary(
  _customer_id uuid
)
RETURNS TABLE(
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
        SELECT
          SUM(
            CASE
              WHEN s.status = 'refunded'
              THEN 0

              ELSE
                GREATEST(
                  s.total
                  -
                  (
                    s.total
                    *
                    COALESCE(
                      (
                        SELECT
                          SUM(
                            (
                              si.unit_price *
                              COALESCE(
                                si.returned_quantity,
                                0
                              )
                            )
                            -
                            (
                              COALESCE(
                                si.discount,
                                0
                              )
                              *
                              (
                                COALESCE(
                                  si.returned_quantity,
                                  0
                                )
                                /
                                NULLIF(
                                  si.quantity,
                                  0
                                )
                              )
                            )
                          )
                        FROM public.sale_items si
                        WHERE si.sale_id = s.id
                      ),
                      0
                    )
                    /
                    NULLIF(
                      (
                        SELECT
                          SUM(
                            (
                              si2.unit_price *
                              si2.quantity
                            )
                            -
                            COALESCE(
                              si2.discount,
                              0
                            )
                          )
                        FROM public.sale_items si2
                        WHERE si2.sale_id = s.id
                      ),
                      0
                    )
                  ),
                  0
                )
            END
          )
        FROM public.sales s
        WHERE s.customer_id =
          _customer_id
          AND s.payment_method =
            'credit'::public.payment_method
          AND s.status IN (
            'completed',
            'partially_refunded',
            'refunded'
          )
          AND public.can_access_branch(
            s.branch_id
          )
      ),
      0
    ),

    COALESCE(
      (
        SELECT
          SUM(cp.amount)
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
TO authenticated, service_role;


-- ============================================================
-- 6. HISTORIAL DE CRÉDITO
--
-- Para una venta parcialmente devuelta se muestra solamente
-- el crédito que permanece pendiente.
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

    CASE
      WHEN s.status = 'refunded'
      THEN 0

      ELSE
        GREATEST(
          s.total
          -
          (
            s.total
            *
            COALESCE(
              (
                SELECT
                  SUM(
                    (
                      si.unit_price *
                      COALESCE(
                        si.returned_quantity,
                        0
                      )
                    )
                    -
                    (
                      COALESCE(
                        si.discount,
                        0
                      )
                      *
                      (
                        COALESCE(
                          si.returned_quantity,
                          0
                        )
                        /
                        NULLIF(
                          si.quantity,
                          0
                        )
                      )
                    )
                  )
                FROM public.sale_items si
                WHERE si.sale_id = s.id
              ),
              0
            )
            /
            NULLIF(
              (
                SELECT
                  SUM(
                    (
                      si2.unit_price *
                      si2.quantity
                    )
                    -
                    COALESCE(
                      si2.discount,
                      0
                    )
                  )
                FROM public.sale_items si2
                WHERE si2.sale_id = s.id
              ),
              0
            )
          ),
          0
        )
    END,

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
      'partially_refunded',
      'refunded'
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
TO authenticated, service_role;


COMMIT;