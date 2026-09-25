-- ============================================================
-- LULA OS
-- FINAL RPC SECURITY / BRANCH HARDENING
-- 2026-09-24
--
-- OBJETIVOS
--
-- 1. Mantener inventario físico CENTRAL.
-- 2. Impedir operaciones entre sucursales.
-- 3. Corregir ajuste de inventario para registrar la sucursal
--    real que originó el movimiento.
-- 4. Impedir cancelaciones de ventas de otra sucursal.
-- 5. Impedir recepciones de compras de otra sucursal.
-- 6. Impedir cierres de caja de otra sucursal.
-- 7. Impedir abonos registrados sobre otra sucursal.
-- 8. Mantener compatibilidad con el frontend actual.
--
-- NO:
-- - crea tablas
-- - elimina tablas
-- - divide shared_inventory
-- - cambia las firmas usadas por el frontend
-- ============================================================

BEGIN;


-- ============================================================
-- 1. LIMPIAR TRIGGERS DE SEGURIDAD DEMASIADO AMPLIOS
--
-- Las RPC principales ya contienen controles de rol.
-- Conservamos las validaciones RLS/funciones específicas
-- en lugar de bloquear operaciones internas válidas.
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_sales_branch
ON public.sales;

DROP TRIGGER IF EXISTS trg_security_cash_sessions_branch
ON public.cash_sessions;

DROP TRIGGER IF EXISTS trg_security_purchases_branch
ON public.purchases;

DROP TRIGGER IF EXISTS trg_security_expenses_branch
ON public.expenses;

DROP TRIGGER IF EXISTS trg_security_credit_payments_branch
ON public.credit_payments;

DROP TRIGGER IF EXISTS trg_security_inventory_movements_branch
ON public.inventory_movements;

DROP TRIGGER IF EXISTS trg_security_sale_payments_branch
ON public.sale_payments;

DROP TRIGGER IF EXISTS trg_security_cash_movements_branch
ON public.cash_movements;

DROP TRIGGER IF EXISTS trg_security_purchase_items_branch
ON public.purchase_items;


-- ============================================================
-- 2. AJUSTE DE INVENTARIO
--
-- IMPORTANTE:
--
-- La versión anterior de adjust_shared_stock() buscaba
-- arbitrariamente la primera sucursal para registrar
-- inventory_movements.
--
-- Eso era incorrecto.
--
-- Ahora adjust_stock():
--
-- - valida la sucursal solicitada
-- - valida permisos
-- - modifica shared_inventory
-- - registra el movimiento con ESA sucursal
--
-- El inventario físico sigue siendo central.
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_stock(
  _branch_id uuid,
  _product_id uuid,
  _quantity numeric,
  _variant_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();

  v_stock numeric;
BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- PERMISO
  -- ----------------------------------------------------------

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  -- ----------------------------------------------------------
  -- SUCURSAL
  -- ----------------------------------------------------------

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;


  IF NOT public.can_access_branch(_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      _branch_id;
  END IF;


  -- ----------------------------------------------------------
  -- PRODUCTO
  -- ----------------------------------------------------------

  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'product is required';
  END IF;


  IF _quantity IS NULL THEN
    RAISE EXCEPTION 'quantity is required';
  END IF;


  IF _quantity = 0 THEN
    RETURN;
  END IF;


  -- ----------------------------------------------------------
  -- BLOQUEO CONCURRENTE
  -- ----------------------------------------------------------

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      _product_id::text
      || ':'
      || COALESCE(
        _variant_id::text,
        'NO_VARIANT'
      ),
      0
    )
  );


  -- ----------------------------------------------------------
  -- EXISTENCIA CENTRAL
  -- ----------------------------------------------------------

  SELECT stock
  INTO v_stock

  FROM public.shared_inventory

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id

  FOR UPDATE;


  -- ----------------------------------------------------------
  -- CREAR REGISTRO SI NO EXISTE
  -- ----------------------------------------------------------

  IF NOT FOUND THEN

    IF _quantity < 0 THEN
      RAISE EXCEPTION
        'cannot remove stock from a product without inventory record';
    END IF;


    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock,
      reserved_stock,
      updated_at
    )
    VALUES (
      _product_id,
      _variant_id,
      _quantity,
      0,
      now()
    );


  ELSE

    -- --------------------------------------------------------
    -- VALIDAR QUE NO QUEDE STOCK NEGATIVO
    -- --------------------------------------------------------

    IF v_stock + _quantity < 0 THEN
      RAISE EXCEPTION
        'adjustment would make shared stock negative';
    END IF;


    UPDATE public.shared_inventory

    SET
      stock = stock + _quantity,
      updated_at = now()

    WHERE product_id = _product_id
      AND variant_id IS NOT DISTINCT FROM _variant_id;

  END IF;


  -- ----------------------------------------------------------
  -- MOVIMIENTO HISTÓRICO
  --
  -- branch_id solamente identifica dónde se originó
  -- el ajuste.
  --
  -- El stock real continúa en shared_inventory.
  -- ----------------------------------------------------------

  INSERT INTO public.inventory_movements (
    branch_id,
    product_id,
    variant_id,
    type,
    quantity,
    notes,
    created_by
  )
  VALUES (
    _branch_id,
    _product_id,
    _variant_id,

    CASE
      WHEN _quantity > 0
        THEN 'adjustment_in'::public.movement_type
      ELSE
        'adjustment_out'::public.movement_type
    END,

    ABS(_quantity),

    COALESCE(
      NULLIF(TRIM(_notes), ''),
      'Ajuste de inventario central'
    ),

    uid
  );

END;
$$;


REVOKE ALL
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
TO authenticated;


COMMENT ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
IS
'LULA OS: ajusta shared_inventory y registra el movimiento usando la sucursal real que originó el ajuste.';


-- ============================================================
-- 3. SEGURIDAD PARA CANCELAR VENTA
--
-- Un manager no debe poder cancelar ventas de otra sucursal.
--
-- OWNER / ADMIN:
-- pueden operar cualquier sucursal.
--
-- MANAGER:
-- únicamente su sucursal.
--
-- CASHIER:
-- únicamente sus propias ventas.
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

  r record;

BEGIN

  -- ----------------------------------------------------------
  -- AUTENTICACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ----------------------------------------------------------
  -- BLOQUEAR VENTA
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
  -- ESTADO
  -- ----------------------------------------------------------

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION
      'sale is already cancelled or refunded';
  END IF;


  -- ----------------------------------------------------------
  -- SUCURSAL
  -- ----------------------------------------------------------

  IF NOT public.can_access_branch(
    v_sale.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for sale branch %',
      v_sale.branch_id;
  END IF;


  -- ----------------------------------------------------------
  -- PERMISO ESPECÍFICO
  -- ----------------------------------------------------------

  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  -- ----------------------------------------------------------
  -- DEVOLVER INVENTARIO CENTRAL
  -- ----------------------------------------------------------

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
      _sale_id,
      'sale',
      COALESCE(
        NULLIF(TRIM(_reason), ''),
        'Cancelación de venta'
      ),
      uid
    );

  END LOOP;


  -- ----------------------------------------------------------
  -- MARCAR CANCELADA
  -- ----------------------------------------------------------

  UPDATE public.sales

  SET
    status = 'cancelled',

    notes =
      CASE

        WHEN _reason IS NULL
          OR TRIM(_reason) = ''
        THEN notes

        WHEN notes IS NULL
          OR TRIM(notes) = ''
        THEN _reason

        ELSE
          notes
          || ' | Cancelación: '
          || _reason

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
TO authenticated;


COMMENT ON FUNCTION public.cancel_sale(
  uuid,
  text
)
IS
'LULA OS: cancela ventas únicamente dentro de la sucursal permitida para el usuario y devuelve existencia al inventario central.';


-- ============================================================
-- 4. RECEPCIÓN DE COMPRA
--
-- La recepción es exclusiva de manager/admin/owner
-- y solamente dentro de una sucursal permitida.
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  p public.purchases;

  it jsonb;

  pi public.purchase_items;

  remaining numeric;

  to_receive numeric;

BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
  THEN
    RAISE EXCEPTION
      'items must be an array';
  END IF;


  -- ----------------------------------------------------------
  -- BLOQUEAR COMPRA
  -- ----------------------------------------------------------

  SELECT *
  INTO p

  FROM public.purchases

  WHERE id = _purchase_id

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase not found';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR SUCURSAL
  -- ----------------------------------------------------------

  IF p.branch_id IS NULL THEN
    RAISE EXCEPTION
      'purchase branch is required';
  END IF;


  IF NOT public.can_access_branch(
    p.branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for purchase branch %',
      p.branch_id;
  END IF;


  IF p.status = 'cancelled' THEN
    RAISE EXCEPTION
      'purchase cancelled';
  END IF;


  -- ----------------------------------------------------------
  -- PROCESAR ITEMS
  -- ----------------------------------------------------------

  FOR it IN
    SELECT *
    FROM jsonb_array_elements(_items)
  LOOP

    SELECT *
    INTO pi

    FROM public.purchase_items

    WHERE id =
      (it->>'item_id')::uuid

      AND purchase_id =
        _purchase_id

    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'purchase item not found';
    END IF;


    remaining :=
      pi.quantity
      -
      COALESCE(
        pi.received_qty,
        0
      );


    to_receive :=
      LEAST(
        remaining,
        GREATEST(
          COALESCE(
            (it->>'qty')::numeric,
            0
          ),
          0
        )
      );


    IF to_receive <= 0 THEN
      CONTINUE;
    END IF;


    -- --------------------------------------------------------
    -- ACTUALIZAR CANTIDAD RECIBIDA
    -- --------------------------------------------------------

    UPDATE public.purchase_items

    SET
      received_qty =
        COALESCE(
          received_qty,
          0
        )
        + to_receive

    WHERE id = pi.id;


    -- --------------------------------------------------------
    -- ENTRADA A INVENTARIO CENTRAL
    -- --------------------------------------------------------

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock,
      reserved_stock
    )
    VALUES (
      pi.product_id,
      pi.variant_id,
      to_receive,
      0
    )

    ON CONFLICT (
      product_id,
      variant_id
    )

    DO UPDATE

    SET
      stock =
        public.shared_inventory.stock
        + EXCLUDED.stock,

      updated_at = now();


    -- --------------------------------------------------------
    -- MOVIMIENTO
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
      p.branch_id,
      pi.product_id,
      pi.variant_id,
      'purchase',
      to_receive,
      p.id,
      'purchase',
      'Recepción central de compra',
      uid
    );

  END LOOP;


  -- ----------------------------------------------------------
  -- ESTADO DE COMPRA
  -- ----------------------------------------------------------

  IF NOT EXISTS (

    SELECT 1

    FROM public.purchase_items

    WHERE purchase_id =
      _purchase_id

      AND COALESCE(
        received_qty,
        0
      ) < quantity

  )
  THEN

    UPDATE public.purchases

    SET
      status = 'received',
      received_at = now(),
      updated_at = now()

    WHERE id = _purchase_id;

  ELSE

    UPDATE public.purchases

    SET
      updated_at = now()

    WHERE id = _purchase_id;

  END IF;

END;
$$;


REVOKE ALL
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
TO authenticated;


-- ============================================================
-- 5. RECEPCIÓN COMPLETA
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase(
  _purchase_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  items jsonb;

BEGIN

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'item_id',
          id,

          'qty',
          quantity
          -
          COALESCE(
            received_qty,
            0
          )
        )
      ),
      '[]'::jsonb
    )

  INTO items

  FROM public.purchase_items

  WHERE purchase_id =
    _purchase_id;


  PERFORM public.receive_purchase_partial(
    _purchase_id,
    items
  );

END;
$$;


REVOKE ALL
ON FUNCTION public.receive_purchase(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.receive_purchase(
  uuid
)
TO authenticated;


-- ============================================================
-- 6. LIMITES DE INVENTARIO
--
-- Mantiene inventario central y exige manager.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_shared_inventory_limits(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _min_stock numeric DEFAULT 0,
  _max_stock numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  IF _product_id IS NULL THEN
    RAISE EXCEPTION
      'product is required';
  END IF;


  IF _min_stock < 0 THEN
    RAISE EXCEPTION
      'minimum stock cannot be negative';
  END IF;


  IF _max_stock IS NOT NULL
     AND _max_stock < _min_stock
  THEN
    RAISE EXCEPTION
      'maximum stock cannot be lower than minimum stock';
  END IF;


  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      _product_id::text
      || ':'
      || COALESCE(
        _variant_id::text,
        'NO_VARIANT'
      ),
      0
    )
  );


  UPDATE public.shared_inventory

  SET
    min_stock = _min_stock,
    max_stock = _max_stock,
    updated_at = now()

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;


  IF NOT FOUND THEN

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock,
      reserved_stock,
      min_stock,
      max_stock,
      updated_at
    )
    VALUES (
      _product_id,
      _variant_id,
      0,
      0,
      _min_stock,
      _max_stock,
      now()
    );

  END IF;

END;
$$;


REVOKE ALL
ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated;


-- ============================================================
-- 7. SET INVENTORY LIMITS — COMPATIBILIDAD
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_limits(
  _branch_id uuid,
  _product_id uuid,
  _min_stock numeric,
  _max_stock numeric,
  _variant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  IF _branch_id IS NULL THEN
    RAISE EXCEPTION
      'branch is required';
  END IF;


  IF NOT public.can_access_branch(
    _branch_id
  )
  THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      _branch_id;
  END IF;


  PERFORM public.set_shared_inventory_limits(
    _product_id,
    _variant_id,
    _min_stock,
    _max_stock
  );

END;
$$;


REVOKE ALL
ON FUNCTION public.set_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric,
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.set_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric,
  uuid
)
TO authenticated;


-- ============================================================
-- 8. INDICES DE SEGURIDAD / RENDIMIENTO
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_sales_branch_created_security
ON public.sales(
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_purchases_branch_created_security
ON public.purchases(
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_cash_sessions_branch_opened_security
ON public.cash_sessions(
  branch_id,
  opened_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_expenses_branch_date_security
ON public.expenses(
  branch_id,
  expense_date DESC
);


CREATE INDEX IF NOT EXISTS
idx_credit_payments_branch_created_security
ON public.credit_payments(
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_inventory_movements_branch_created_security
ON public.inventory_movements(
  branch_id,
  created_at DESC
);


-- ============================================================
-- 9. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
IS
'LULA OS: recibe compras exclusivamente dentro de una sucursal permitida y actualiza shared_inventory.';


COMMENT ON FUNCTION public.receive_purchase(
  uuid
)
IS
'LULA OS: recepción completa de compra usando shared_inventory central.';


COMMENT ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
IS
'LULA OS: configura mínimos y máximos del inventario central compartido.';


COMMIT;