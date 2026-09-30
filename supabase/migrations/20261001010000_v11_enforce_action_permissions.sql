-- ============================================================
-- LULA OS v1.1 PASO 2 — Enforce action permissions in backend
-- ============================================================
-- NO reemplaza is_manager() globalmente.
-- Añade has_permission() en RPCs y políticas sensibles.
-- NO modifica inventario compartido ni create_sale body.
-- ============================================================

BEGIN;


-- ============================================================
-- RLS: productos, gastos, caja — permisos granulares
-- ============================================================

-- PRODUCTOS: reemplaza w_products (solo is_manager)
DROP POLICY IF EXISTS w_products ON public.products;
DROP POLICY IF EXISTS products_insert_permission ON public.products;
DROP POLICY IF EXISTS products_update_permission ON public.products;
DROP POLICY IF EXISTS products_delete_permission ON public.products;

CREATE POLICY products_insert_permission
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('productos.create')
);

CREATE POLICY products_update_permission
ON public.products
FOR UPDATE
TO authenticated
USING (
  public.has_permission('productos.edit')
  OR public.has_permission('productos.price')
)
WITH CHECK (
  public.has_permission('productos.edit')
  OR public.has_permission('productos.price')
);

CREATE POLICY products_delete_permission
ON public.products
FOR DELETE
TO authenticated
USING (
  public.has_permission('productos.delete')
);

-- GASTOS
DROP POLICY IF EXISTS expenses_select ON public.expenses;
DROP POLICY IF EXISTS expenses_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_update ON public.expenses;
DROP POLICY IF EXISTS expenses_delete ON public.expenses;
DROP POLICY IF EXISTS r_expenses ON public.expenses;
DROP POLICY IF EXISTS c_expenses ON public.expenses;
DROP POLICY IF EXISTS u_expenses ON public.expenses;
DROP POLICY IF EXISTS d_expenses ON public.expenses;

-- Policies may have different names; try common patterns from harden
DROP POLICY IF EXISTS expenses_branch_select ON public.expenses;
DROP POLICY IF EXISTS expenses_branch_insert ON public.expenses;
DROP POLICY IF EXISTS expenses_branch_update ON public.expenses;
DROP POLICY IF EXISTS expenses_branch_delete ON public.expenses;

CREATE POLICY expenses_select_auth
ON public.expenses
FOR SELECT
TO authenticated
USING (
  public.has_permission('gastos.view')
  AND (
    public.is_manager()
    OR public.can_access_branch(branch_id)
  )
);

CREATE POLICY expenses_insert_auth
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('gastos.create')
  AND public.can_access_branch(branch_id)
);

CREATE POLICY expenses_update_auth
ON public.expenses
FOR UPDATE
TO authenticated
USING (
  public.has_permission('gastos.edit')
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  public.has_permission('gastos.edit')
  AND public.can_access_branch(branch_id)
);

CREATE POLICY expenses_delete_auth
ON public.expenses
FOR DELETE
TO authenticated
USING (
  public.has_permission('gastos.delete')
  AND public.can_access_branch(branch_id)
);

-- CAJA: apertura / movimientos
DROP POLICY IF EXISTS c_cash_sessions ON public.cash_sessions;
CREATE POLICY c_cash_sessions
ON public.cash_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('caja.open')
  AND opened_by = auth.uid()
  AND public.can_access_branch(branch_id)
);

DROP POLICY IF EXISTS c_cash_movements ON public.cash_movements;
DROP POLICY IF EXISTS cash_movements_insert ON public.cash_movements;

CREATE POLICY cash_movements_insert_perm
ON public.cash_movements
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_permission('caja.movement')
);


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


  IF NOT public.has_permission('caja.close') THEN
    RAISE EXCEPTION
      'not authorized: caja.close';
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

  IF NOT public.has_permission('ventas.cancel') THEN
    RAISE EXCEPTION
      'not authorized: ventas.cancel';
  END IF;

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

  IF NOT public.has_permission('devoluciones.create') THEN
    RAISE EXCEPTION
      'not authorized: devoluciones.create';
  END IF;

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

  IF NOT public.has_permission('clientes.credit_payment') THEN
    RAISE EXCEPTION
      'not authorized: clientes.credit_payment';
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


-- Grants already on has_permission

COMMIT;
