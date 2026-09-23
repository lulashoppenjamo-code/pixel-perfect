-- ============================================================
-- LULA OS — PARTE 4
-- PUENTE OPERATIVO CENTRAL
--
-- OBJETIVO:
-- Convertir shared_inventory en el inventario operativo
-- principal de Lula OS.
--
-- POS
-- COMPRAS
-- CANCELACIONES
-- AJUSTES
-- DISPONIBILIDAD
--
-- La tabla inventory original NO se elimina.
-- Se conserva para histórico/compatibilidad.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. AJUSTE DE INVENTARIO
--
-- Mantiene la firma existente para evitar romper el frontend.
-- El stock real ahora se modifica en shared_inventory.
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
SET search_path = public
AS $$
BEGIN

  PERFORM public.adjust_shared_stock(
    _product_id,
    _variant_id,
    _quantity,
    COALESCE(
      _notes,
      'Ajuste desde inventario'
    )
  );

END;
$$;


GRANT EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
TO authenticated;


-- ============================================================
-- 2. POS — CREAR VENTA
--
-- MISMA FIRMA QUE LA FUNCIÓN ACTUAL.
--
-- CAMBIO PRINCIPAL:
-- Ya NO descuenta inventory por sucursal.
-- Descuenta shared_inventory.
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
SET search_path = public
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

BEGIN

  -- ==========================================================
  -- SEGURIDAD
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0
  THEN
    RAISE EXCEPTION 'empty cart';
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


  IF _discount < 0 THEN
    RAISE EXCEPTION
      'discount cannot be negative';
  END IF;


  IF _payment_method = 'credit'
     AND _customer_id IS NULL
  THEN
    RAISE EXCEPTION
      'customer is required for credit sales';
  END IF;


  -- ==========================================================
  -- CALCULAR TOTAL
  -- ==========================================================

  FOR it IN
    SELECT *
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


    v_subtotal :=
      v_subtotal
      + v_line;


    v_tax :=
      v_tax
      +
      ROUND(
        v_line
        * COALESCE(
            v_rate,
            0
          ),
        2
      );

  END LOOP;


  v_total :=
    GREATEST(
      v_subtotal
      + v_tax
      - COALESCE(
          _discount,
          0
        ),
      0
    );


  -- ==========================================================
  -- VALIDAR EFECTIVO
  -- ==========================================================

  IF _payment_method = 'cash'
     AND _cash_received IS NOT NULL
     AND _cash_received < v_total
  THEN

    RAISE EXCEPTION
      'cash received is less than sale total';

  END IF;


  -- ==========================================================
  -- VALIDAR INVENTARIO CENTRAL
  --
  -- FOR UPDATE evita que dos ventas simultáneas
  -- consuman el mismo stock.
  -- ==========================================================

  FOR it IN
    SELECT *
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

  INSERT INTO public.sales(
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

  VALUES(

    _branch_id,

    uid,

    _customer_id,

    _cash_session_id,

    v_subtotal,

    v_tax,

    COALESCE(
      _discount,
      0
    ),

    v_total,

    _payment_method,

    _cash_received,

    CASE

      WHEN _cash_received IS NULL
      THEN NULL

      ELSE
        GREATEST(
          _cash_received
          - v_total,
          0
        )

    END,

    'completed'

  )

  RETURNING *
  INTO v_sale;


  -- ==========================================================
  -- PROCESAR PRODUCTOS
  -- ==========================================================

  FOR it IN
    SELECT *
    FROM jsonb_array_elements(_items)
  LOOP

    v_qty :=
      (it->>'quantity')::numeric;


    v_variant :=
      NULLIF(
        it->>'variant_id',
        ''
      )::uuid;


    -- ========================================================
    -- COSTO HISTÓRICO
    -- ========================================================

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


    -- ========================================================
    -- DETALLE DE VENTA
    -- ========================================================

    INSERT INTO public.sale_items(

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

    VALUES(

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

      COALESCE(
        v_cost,
        0
      ),

      COALESCE(
        v_cost,
        0
      )
      * v_qty

    );


    -- ========================================================
    -- DESCONTAR INVENTARIO CENTRAL
    -- ========================================================

    PERFORM public.consume_shared_stock(

      (it->>'product_id')::uuid,

      v_variant,

      v_qty

    );


    -- ========================================================
    -- REGISTRAR MOVIMIENTO
    -- ========================================================

    INSERT INTO public.inventory_movements(

      branch_id,

      product_id,

      variant_id,

      type,

      quantity,

      reference_id,

      reference_type,

      created_by

    )

    VALUES(

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
  -- REGISTRAR PAGO
  -- ==========================================================

  INSERT INTO public.sale_payments(

    sale_id,

    payment_method,

    amount,

    created_by

  )

  VALUES(

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
-- 3. CANCELAR VENTA
--
-- Regresa mercancía al inventario central.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_sale(
  _sale_id uuid,
  _reason text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

  uid uuid := auth.uid();

  v_sale public.sales;

  r record;

BEGIN

  IF uid IS NULL THEN

    RAISE EXCEPTION
      'not authenticated';

  END IF;


  SELECT *

  INTO v_sale

  FROM public.sales

  WHERE id = _sale_id

  FOR UPDATE;


  IF v_sale.id IS NULL THEN

    RAISE EXCEPTION
      'sale not found';

  END IF;


  IF v_sale.status <> 'completed' THEN

    RAISE EXCEPTION
      'sale is already cancelled or refunded';

  END IF;


  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager()
  THEN

    RAISE EXCEPTION
      'not allowed';

  END IF;


  -- ==========================================================
  -- DEVOLVER PRODUCTOS
  -- ==========================================================

  FOR r IN

    SELECT

      product_id,

      variant_id,

      quantity

    FROM public.sale_items

    WHERE sale_id = _sale_id

  LOOP


    INSERT INTO public.shared_inventory(

      product_id,

      variant_id,

      stock

    )

    VALUES(

      r.product_id,

      r.variant_id,

      r.quantity

    )

    ON CONFLICT(
      product_id,
      variant_id
    )

    DO UPDATE

    SET

      stock =
        public.shared_inventory.stock
        + EXCLUDED.stock,

      updated_at =
        now();


    INSERT INTO public.inventory_movements(

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

    VALUES(

      v_sale.branch_id,

      r.product_id,

      r.variant_id,

      'return',

      r.quantity,

      _sale_id,

      'sale',

      COALESCE(
        _reason,
        'Cancelación de venta'
      ),

      uid

    );

  END LOOP;


  -- ==========================================================
  -- MARCAR CANCELADA
  -- ==========================================================

  UPDATE public.sales

  SET

    status = 'cancelled',

    notes =

      CASE

        WHEN _reason IS NULL
             OR _reason = ''

        THEN notes

        WHEN notes IS NULL
             OR notes = ''

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


GRANT EXECUTE

ON FUNCTION public.cancel_sale(
  uuid,
  text
)

TO authenticated;


-- ============================================================
-- 4. COMPRAS — RECEPCIÓN PARCIAL
--
-- Las compras recibidas entran al inventario central.
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    RAISE EXCEPTION
      'not authenticated';

  END IF;


  IF NOT public.is_manager() THEN

    RAISE EXCEPTION
      'not allowed';

  END IF;


  SELECT *

  INTO p

  FROM public.purchases

  WHERE id = _purchase_id

  FOR UPDATE;


  IF p.id IS NULL THEN

    RAISE EXCEPTION
      'purchase not found';

  END IF;


  IF p.status = 'cancelled' THEN

    RAISE EXCEPTION
      'purchase cancelled';

  END IF;


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


    IF pi.id IS NULL THEN

      RAISE EXCEPTION
        'item not found';

    END IF;


    remaining :=
      pi.quantity
      - COALESCE(
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


    UPDATE public.purchase_items

    SET

      received_qty =
        COALESCE(
          received_qty,
          0
        )
        + to_receive

    WHERE id = pi.id;


    -- ========================================================
    -- ENTRADA AL INVENTARIO CENTRAL
    -- ========================================================

    INSERT INTO public.shared_inventory(

      product_id,

      variant_id,

      stock

    )

    VALUES(

      pi.product_id,

      pi.variant_id,

      to_receive

    )

    ON CONFLICT(
      product_id,
      variant_id
    )

    DO UPDATE

    SET

      stock =
        public.shared_inventory.stock
        + EXCLUDED.stock,

      updated_at = now();


    -- ========================================================
    -- MOVIMIENTO
    -- ========================================================

    INSERT INTO public.inventory_movements(

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

    VALUES(

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


  -- ==========================================================
  -- ACTUALIZAR ESTADO
  -- ==========================================================

  IF NOT EXISTS(

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


GRANT EXECUTE

ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)

TO authenticated;


-- ============================================================
-- 5. RECEPCIÓN COMPLETA DE COMPRA
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase(
  _purchase_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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


GRANT EXECUTE

ON FUNCTION public.receive_purchase(
  uuid
)

TO authenticated;


-- ============================================================
-- 6. COMPATIBILIDAD
--
-- Cualquier módulo antiguo que solicite stock por sucursal
-- recibirá ahora el stock central.
-- ============================================================

CREATE OR REPLACE FUNCTION public.available_stock(
  _branch_id uuid,
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_shared_stock(
    _product_id,
    _variant_id
  );
$$;


GRANT EXECUTE

ON FUNCTION public.available_stock(
  uuid,
  uuid,
  uuid
)

TO authenticated;


-- ============================================================
-- 7. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
sale_items_sale_product_idx

ON public.sale_items(
  sale_id,
  product_id
);


CREATE INDEX IF NOT EXISTS
shared_inventory_active_product_idx

ON public.shared_inventory(
  product_id,
  variant_id
)

WHERE stock > 0;


COMMIT;