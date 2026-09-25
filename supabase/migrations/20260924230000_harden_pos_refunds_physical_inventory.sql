-- ============================================================
-- LULA OS
-- POS + DEVOLUCIONES + INVENTARIO FÍSICO
-- SEGURIDAD FINAL POR SUCURSAL
-- 2026-09-24
--
-- OBJETIVOS
--
-- 1. create_sale:
--    - validar acceso real a la sucursal
--    - validar caja si se proporciona
--    - mantener shared_inventory como existencia única
--
-- 2. refund_sale:
--    - impedir devoluciones entre sucursales
--    - mantener devolución sobre shared_inventory
--
-- 3. inventario físico:
--    - validar sucursal al iniciar
--    - validar sucursal al capturar
--    - validar sucursal al cerrar
--    - mantener shared_inventory como fuente única
--
-- NO:
-- - crea tablas
-- - elimina tablas
-- - divide inventario
-- - cambia firmas utilizadas por el frontend
-- ============================================================

BEGIN;


-- ============================================================
-- 1. POS — CREAR VENTA
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_sale(
  _branch_id uuid,
  _items jsonb,
  _payment_method public.payment_method DEFAULT 'cash',
  _customer_id uuid DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL,
  _discount numeric DEFAULT 0,
  _cash_received numeric DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  it jsonb;

  v_sale public.sales;

  v_subtotal numeric(12,2) := 0;
  v_tax numeric(12,2) := 0;
  v_total numeric(12,2) := 0;

  v_line numeric(12,2);

  v_rate numeric(5,4);

  v_cost numeric(12,2);

  v_qty numeric(12,2);

  v_variant uuid;

  v_available numeric(12,2);

  v_cash_branch uuid;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ==========================================================
  -- CARRITO
  -- ==========================================================

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0
  THEN
    RAISE EXCEPTION 'empty cart';
  END IF;


  -- ==========================================================
  -- SUCURSAL
  -- ==========================================================

  IF _branch_id IS NULL THEN
    RAISE EXCEPTION 'branch is required';
  END IF;


  IF NOT public.can_access_branch(_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      _branch_id;
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = true
  )
  THEN
    RAISE EXCEPTION
      'branch not found or inactive';
  END IF;


  -- ==========================================================
  -- DESCUENTO
  -- ==========================================================

  IF COALESCE(_discount, 0) < 0 THEN
    RAISE EXCEPTION
      'discount cannot be negative';
  END IF;


  -- ==========================================================
  -- CRÉDITO
  -- ==========================================================

  IF _payment_method = 'credit'
     AND _customer_id IS NULL
  THEN
    RAISE EXCEPTION
      'customer is required for credit sales';
  END IF;


  -- ==========================================================
  -- CAJA
  --
  -- Si se proporciona una sesión de caja:
  -- - debe existir
  -- - debe estar abierta
  -- - debe pertenecer a la misma sucursal
  -- ==========================================================

  IF _cash_session_id IS NOT NULL THEN

    SELECT branch_id
    INTO v_cash_branch
    FROM public.cash_sessions
    WHERE id = _cash_session_id
      AND status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'cash session not found or not open';
    END IF;


    IF v_cash_branch IS DISTINCT FROM _branch_id THEN
      RAISE EXCEPTION
        'cash session belongs to another branch';
    END IF;


    IF NOT public.can_access_branch(v_cash_branch) THEN
      RAISE EXCEPTION
        'not allowed for cash session branch';
    END IF;

  END IF;


  -- ==========================================================
  -- VALIDAR EFECTIVO
  -- ==========================================================

  IF _payment_method = 'cash'
     AND _cash_received IS NOT NULL
     AND _cash_received < 0
  THEN
    RAISE EXCEPTION
      'cash received cannot be negative';
  END IF;


  -- ==========================================================
  -- CALCULAR TOTAL
  -- ==========================================================

  FOR it IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    v_qty :=
      COALESCE(
        (it->>'quantity')::numeric,
        0
      );


    IF v_qty <= 0 THEN
      RAISE EXCEPTION
        'invalid quantity for product %',
        it->>'product_id';
    END IF;


    IF (it->>'product_id') IS NULL
       OR (it->>'product_id') = ''
    THEN
      RAISE EXCEPTION
        'product_id is required';
    END IF;


    IF (it->>'unit_price') IS NULL THEN
      RAISE EXCEPTION
        'unit_price is required';
    END IF;


    v_line :=
      (
        (it->>'unit_price')::numeric
        * v_qty
      )
      -
      COALESCE(
        (it->>'discount')::numeric,
        0
      );


    IF v_line < 0 THEN
      RAISE EXCEPTION
        'invalid line total';
    END IF;


    SELECT
      COALESCE(
        p.tax_rate,
        0
      )
    INTO v_rate
    FROM public.products p
    WHERE p.id =
      (it->>'product_id')::uuid;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'product not found: %',
        it->>'product_id';
    END IF;


    v_subtotal :=
      v_subtotal
      + v_line;


    v_tax :=
      v_tax
      +
      ROUND(
        v_line
        * COALESCE(v_rate, 0),
        2
      );

  END LOOP;


  v_total :=
    GREATEST(
      v_subtotal
      + v_tax
      - COALESCE(_discount, 0),
      0
    );


  IF _payment_method = 'cash'
     AND _cash_received IS NOT NULL
     AND _cash_received < v_total
  THEN
    RAISE EXCEPTION
      'cash received is less than sale total';
  END IF;


  -- ==========================================================
  -- INVENTARIO CENTRAL
  --
  -- Se bloquean las filas antes de crear la venta.
  -- ==========================================================

  FOR it IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    v_qty :=
      (it->>'quantity')::numeric;


    v_variant :=
      NULLIF(
        it->>'variant_id',
        ''
      )::uuid;


    SELECT
      GREATEST(
        stock - reserved_stock,
        0
      )
    INTO v_available
    FROM public.shared_inventory
    WHERE product_id =
      (it->>'product_id')::uuid
      AND variant_id
          IS NOT DISTINCT FROM v_variant
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'product inventory not found: %',
        it->>'product_id';
    END IF;


    IF v_available < v_qty THEN
      RAISE EXCEPTION
        'insufficient shared stock for product % (available %, requested %)',
        it->>'product_id',
        v_available,
        v_qty;
    END IF;

  END LOOP;


  -- ==========================================================
  -- CREAR VENTA
  -- ==========================================================

  INSERT INTO public.sales (
    branch_id,
    cashier_id,
    customer_id,
    cash_session_id,
    subtotal,
    tax,
    discount,
    total,
    payment_method,
    cash_received,
    change_given,
    status
  )
  VALUES (
    _branch_id,
    uid,
    _customer_id,
    _cash_session_id,
    v_subtotal,
    v_tax,
    COALESCE(_discount, 0),
    v_total,
    _payment_method,
    _cash_received,

    CASE
      WHEN _cash_received IS NULL
      THEN NULL
      ELSE GREATEST(
        _cash_received - v_total,
        0
      )
    END,

    'completed'
  )
  RETURNING *
  INTO v_sale;


  -- ==========================================================
  -- PROCESAR PARTIDAS
  -- ==========================================================

  FOR it IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    v_qty :=
      (it->>'quantity')::numeric;


    v_variant :=
      NULLIF(
        it->>'variant_id',
        ''
      )::uuid;


    -- --------------------------------------------------------
    -- COSTO HISTÓRICO
    -- --------------------------------------------------------

    SELECT
      COALESCE(
        CASE
          WHEN v_variant IS NOT NULL
          THEN pv.cost_override
          ELSE NULL
        END,
        p.cost,
        0
      )
    INTO v_cost
    FROM public.products p
    LEFT JOIN public.product_variants pv
      ON pv.id = v_variant
    WHERE p.id =
      (it->>'product_id')::uuid;


    -- --------------------------------------------------------
    -- DETALLE DE VENTA
    -- --------------------------------------------------------

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      variant_id,
      name_snapshot,
      unit_price,
      quantity,
      discount,
      total,
      unit_cost,
      cost_total
    )
    VALUES (
      v_sale.id,

      (it->>'product_id')::uuid,

      v_variant,

      COALESCE(
        it->>'name',
        (
          SELECT name
          FROM public.products
          WHERE id =
            (it->>'product_id')::uuid
        )
      ),

      (it->>'unit_price')::numeric,

      v_qty,

      COALESCE(
        (it->>'discount')::numeric,
        0
      ),

      (
        (it->>'unit_price')::numeric
        * v_qty
      )
      -
      COALESCE(
        (it->>'discount')::numeric,
        0
      ),

      COALESCE(v_cost, 0),

      COALESCE(v_cost, 0)
      * v_qty
    );


    -- --------------------------------------------------------
    -- CONSUMIR EXISTENCIA CENTRAL
    -- --------------------------------------------------------

    PERFORM public.consume_shared_stock(
      (it->>'product_id')::uuid,
      v_variant,
      v_qty
    );


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
      created_by
    )
    VALUES (
      _branch_id,
      (it->>'product_id')::uuid,
      v_variant,
      'sale',
      -v_qty,
      v_sale.id,
      'sale',
      uid
    );

  END LOOP;


  -- ==========================================================
  -- PAGO
  -- ==========================================================

  INSERT INTO public.sale_payments (
    sale_id,
    payment_method,
    amount,
    created_by
  )
  VALUES (
    v_sale.id,
    _payment_method,
    v_total,
    uid
  );


  RETURN v_sale;

END;
$$;


REVOKE ALL
ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  numeric,
  numeric
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 2. DEVOLUCIONES
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

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  -- ==========================================================
  -- ITEMS
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


    IF v_sale_item.product_id IS NULL THEN
      RAISE EXCEPTION
        'cannot restore inventory for sale item without product';
    END IF;


    UPDATE public.sale_items
    SET
      returned_quantity =
        COALESCE(returned_quantity, 0)
        + v_requested_qty
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
        NULLIF(TRIM(_reason), ''),
        'Devolución de venta'
      ),
      uid
    );

  END LOOP;


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
        THEN 'refunded'::public.sale_status
        ELSE 'partially_refunded'::public.sale_status
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
-- 3. INICIAR INVENTARIO FÍSICO CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_inventory_count(
  _branch_id uuid,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  count_id uuid;

BEGIN

  IF uid IS NULL THEN
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


  IF NOT public.can_access_branch(_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      _branch_id;
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = true
  )
  THEN
    RAISE EXCEPTION
      'branch not found or inactive';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM public.inventory_counts
    WHERE branch_id = _branch_id
      AND status = 'counting'
  )
  THEN
    RAISE EXCEPTION
      'there is already an active inventory count';
  END IF;


  INSERT INTO public.inventory_counts (
    branch_id,
    status,
    notes,
    started_by
  )
  VALUES (
    _branch_id,
    'counting',
    _notes,
    uid
  )
  RETURNING id
  INTO count_id;


  -- ==========================================================
  -- SNAPSHOT CENTRAL
  -- ==========================================================

  INSERT INTO public.inventory_count_items (
    count_id,
    product_id,
    variant_id,
    system_stock,
    counted_stock,
    unit_cost
  )
  SELECT
    count_id,
    si.product_id,
    si.variant_id,
    si.stock,
    NULL,
    COALESCE(si.cost, 0)
  FROM public.shared_inventory si
  INNER JOIN public.products p
    ON p.id = si.product_id
  WHERE p.is_active = true;


  RETURN count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.start_inventory_count(uuid, text)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.start_inventory_count(uuid, text)
TO authenticated, service_role;


-- ============================================================
-- 4. CAPTURAR CONTEO
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_count_item(
  _count_id uuid,
  _item_id uuid,
  _counted_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  v_system numeric;

  v_cost numeric;

  v_status text;

  v_branch_id uuid;

BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  IF _counted_stock IS NULL THEN
    RAISE EXCEPTION
      'counted stock is required';
  END IF;


  IF _counted_stock < 0 THEN
    RAISE EXCEPTION
      'counted stock cannot be negative';
  END IF;


  SELECT
    c.status,
    c.branch_id,
    i.system_stock,
    i.unit_cost
  INTO
    v_status,
    v_branch_id,
    v_system,
    v_cost
  FROM public.inventory_count_items i
  INNER JOIN public.inventory_counts c
    ON c.id = i.count_id
  WHERE i.id = _item_id
    AND i.count_id = _count_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count item not found';
  END IF;


  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for inventory count branch %',
      v_branch_id;
  END IF;


  IF v_status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not active';
  END IF;


  UPDATE public.inventory_count_items
  SET
    counted_stock = _counted_stock,

    difference =
      _counted_stock - v_system,

    difference_value =
      (
        _counted_stock - v_system
      )
      * COALESCE(v_cost, 0),

    counted_at = now()

  WHERE id = _item_id
    AND count_id = _count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 5. COMPLETAR INVENTARIO FÍSICO CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  c public.inventory_counts;

  item record;

  v_current_stock numeric;

  v_difference numeric;

BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  SELECT *
  INTO c
  FROM public.inventory_counts
  WHERE id = _count_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'inventory count not found';
  END IF;


  IF NOT public.can_access_branch(c.branch_id) THEN
    RAISE EXCEPTION
      'not allowed for inventory count branch %',
      c.branch_id;
  END IF;


  IF c.status <> 'counting' THEN
    RAISE EXCEPTION
      'inventory count is not in counting status';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM public.inventory_count_items
    WHERE count_id = _count_id
      AND counted_stock IS NULL
  )
  THEN
    RAISE EXCEPTION
      'there are products without physical count';
  END IF;


  -- ==========================================================
  -- APLICAR SOBRE SHARED_INVENTORY
  -- ==========================================================

  FOR item IN
    SELECT
      i.id,
      i.product_id,
      i.variant_id,
      i.system_stock,
      i.counted_stock,
      i.unit_cost
    FROM public.inventory_count_items i
    WHERE i.count_id = _count_id
  LOOP

    SELECT stock
    INTO v_current_stock
    FROM public.shared_inventory
    WHERE product_id = item.product_id
      AND variant_id
          IS NOT DISTINCT FROM item.variant_id
    FOR UPDATE;


    IF NOT FOUND THEN

      INSERT INTO public.shared_inventory (
        product_id,
        variant_id,
        stock,
        reserved_stock,
        updated_at
      )
      VALUES (
        item.product_id,
        item.variant_id,
        item.counted_stock,
        0,
        now()
      );


      v_difference :=
        item.counted_stock
        - item.system_stock;

    ELSE

      v_difference :=
        item.counted_stock
        - v_current_stock;


      UPDATE public.shared_inventory
      SET
        stock = item.counted_stock,

        reserved_stock =
          LEAST(
            reserved_stock,
            item.counted_stock
          ),

        updated_at = now()

      WHERE product_id = item.product_id
        AND variant_id
            IS NOT DISTINCT FROM item.variant_id;

    END IF;


    -- ========================================================
    -- MOVIMIENTO DE DIFERENCIA
    -- ========================================================

    IF ABS(v_difference) > 0.000001 THEN

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
        c.branch_id,
        item.product_id,
        item.variant_id,

        CASE
          WHEN v_difference > 0
          THEN 'adjustment_in'::public.movement_type
          ELSE 'adjustment_out'::public.movement_type
        END,

        ABS(v_difference),

        _count_id,

        'inventory_count',

        CASE
          WHEN v_difference > 0
          THEN 'Sobrante de inventario físico central'
          ELSE 'Faltante de inventario físico central'
        END,

        uid
      );

    END IF;

  END LOOP;


  -- ==========================================================
  -- CERRAR INVENTARIO
  -- ==========================================================

  UPDATE public.inventory_counts
  SET
    status = 'completed',
    completed_by = uid,
    completed_at = now()
  WHERE id = _count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.complete_inventory_count(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(uuid)
TO authenticated, service_role;


-- ============================================================
-- 6. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  numeric,
  numeric
)
IS
'LULA OS: crea ventas usando shared_inventory y valida acceso a la sucursal y caja.';


COMMENT ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
IS
'LULA OS: devuelve mercancía a shared_inventory validando acceso a la sucursal de la venta.';


COMMENT ON FUNCTION public.start_inventory_count(
  uuid,
  text
)
IS
'LULA OS: inicia inventario físico central validando la sucursal autorizada.';


COMMENT ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
IS
'LULA OS: captura conteo físico únicamente para un inventario de una sucursal autorizada.';


COMMENT ON FUNCTION public.complete_inventory_count(
  uuid
)
IS
'LULA OS: completa inventario físico aplicando diferencias exclusivamente sobre shared_inventory.';


-- ============================================================
-- 7. ÍNDICES DE APOYO
-- ============================================================

CREATE INDEX IF NOT EXISTS
inventory_counts_branch_status_idx
ON public.inventory_counts (
  branch_id,
  status
);


CREATE INDEX IF NOT EXISTS
inventory_count_items_count_idx
ON public.inventory_count_items (
  count_id,
  counted_stock
);


CREATE INDEX IF NOT EXISTS
sales_branch_status_idx
ON public.sales (
  branch_id,
  status
);


CREATE INDEX IF NOT EXISTS
sale_items_sale_idx
ON public.sale_items (
  sale_id
);


COMMIT;