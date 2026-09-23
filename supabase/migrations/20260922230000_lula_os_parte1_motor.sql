-- ============================================================
-- LULA OS — PARTE 1/3
-- MOTOR PROFESIONAL + SEGURIDAD + POS + INVENTARIO
-- ============================================================
-- IMPORTANTE:
-- Esta migración es evolutiva.
-- NO elimina tablas.
-- NO elimina datos.
-- NO cambia el framework.
-- Mantiene las firmas RPC existentes que usa el frontend.
--
-- Incluye:
-- 1. Costo histórico de ventas
-- 2. Pagos mixtos
-- 3. Inventario físico profesional
-- 4. Auditoría
-- 5. Cancelación segura de ventas
-- 6. Validaciones de venta
-- 7. Crédito
-- 8. Utilidad real
-- 9. Seguridad/RLS
-- ============================================================


-- ============================================================
-- 1. COLUMNAS HISTÓRICAS DE VENTA
-- ============================================================

ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS cost_total numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS sale_items_sale_idx
ON public.sale_items(sale_id);


-- ============================================================
-- 2. PAGOS DE UNA VENTA
-- Permite:
-- efectivo
-- tarjeta
-- transferencia
-- crédito
-- mixto
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_id uuid NOT NULL
    REFERENCES public.sales(id)
    ON DELETE CASCADE,

  payment_method public.payment_method NOT NULL,

  amount numeric(12,2) NOT NULL
    CHECK (amount > 0),

  reference text,

  created_by uuid,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sale_payments_sale_idx
ON public.sale_payments(sale_id);

CREATE INDEX IF NOT EXISTS sale_payments_method_idx
ON public.sale_payments(payment_method);


-- ============================================================
-- 3. RLS PAGOS
-- ============================================================

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS r_sale_payments ON public.sale_payments;
DROP POLICY IF EXISTS c_sale_payments ON public.sale_payments;
DROP POLICY IF EXISTS u_sale_payments ON public.sale_payments;
DROP POLICY IF EXISTS d_sale_payments ON public.sale_payments;

CREATE POLICY r_sale_payments
ON public.sale_payments
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY c_sale_payments
ON public.sale_payments
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  OR created_by IS NULL
);

CREATE POLICY u_sale_payments
ON public.sale_payments
FOR UPDATE
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());

CREATE POLICY d_sale_payments
ON public.sale_payments
FOR DELETE
TO authenticated
USING (public.is_manager());

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.sale_payments
TO authenticated;

GRANT ALL
ON public.sale_payments
TO service_role;


-- ============================================================
-- 4. FUNCIÓN PARA REGISTRAR PAGOS MIXTOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_sale_payments(
  _sale_id uuid,
  _payments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale public.sales;
  v_payment jsonb;
  v_total numeric(12,2) := 0;
  v_amount numeric(12,2);
  v_count integer := 0;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'sale not found';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'sale is not active';
  END IF;

  IF _payments IS NULL
     OR jsonb_typeof(_payments) <> 'array'
     OR jsonb_array_length(_payments) = 0 THEN
    RAISE EXCEPTION 'empty payments';
  END IF;

  DELETE FROM public.sale_payments
  WHERE sale_id = _sale_id;

  FOR v_payment IN
    SELECT *
    FROM jsonb_array_elements(_payments)
  LOOP

    v_amount := COALESCE(
      (v_payment->>'amount')::numeric,
      0
    );

    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'payment amount must be greater than zero';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('cash'::text),
          ('card'::text),
          ('transfer'::text),
          ('credit'::text),
          ('mixed'::text)
      ) AS allowed(method)
      WHERE allowed.method = v_payment->>'payment_method'
    ) THEN
      RAISE EXCEPTION 'invalid payment method';
    END IF;

    INSERT INTO public.sale_payments(
      sale_id,
      payment_method,
      amount,
      reference,
      created_by
    )
    VALUES(
      _sale_id,
      (v_payment->>'payment_method')::public.payment_method,
      v_amount,
      NULLIF(v_payment->>'reference', ''),
      uid
    );

    v_total := v_total + v_amount;
    v_count := v_count + 1;

  END LOOP;

  IF ROUND(v_total, 2) <> ROUND(v_sale.total, 2) THEN
    RAISE EXCEPTION
      'split payments total % but sale total is %',
      ROUND(v_total, 2),
      ROUND(v_sale.total, 2);
  END IF;

  UPDATE public.sales
  SET
    payment_method =
      CASE
        WHEN v_count > 1
          THEN 'mixed'::public.payment_method
        ELSE (
          SELECT payment_method
          FROM public.sale_payments
          WHERE sale_id = _sale_id
          LIMIT 1
        )
      END,
    updated_at = now()
  WHERE id = _sale_id;

END;
$$;

REVOKE ALL
ON FUNCTION public.record_sale_payments(uuid, jsonb)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.record_sale_payments(uuid, jsonb)
TO authenticated, service_role;


-- ============================================================
-- 5. INVENTARIO FÍSICO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  branch_id uuid NOT NULL
    REFERENCES public.branches(id)
    ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'open'
    CHECK (
      status IN (
        'open',
        'completed',
        'cancelled'
      )
    ),

  notes text,

  started_by uuid NOT NULL,

  completed_by uuid,

  started_at timestamptz NOT NULL DEFAULT now(),

  completed_at timestamptz
);


CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  count_id uuid NOT NULL
    REFERENCES public.inventory_counts(id)
    ON DELETE CASCADE,

  product_id uuid NOT NULL
    REFERENCES public.products(id)
    ON DELETE CASCADE,

  variant_id uuid
    REFERENCES public.product_variants(id)
    ON DELETE SET NULL,

  system_stock numeric(12,2) NOT NULL DEFAULT 0,

  physical_stock numeric(12,2),

  difference numeric(12,2),

  unit_cost numeric(12,2) NOT NULL DEFAULT 0,

  difference_value numeric(12,2),

  counted_by uuid,

  counted_at timestamptz
);


CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_item_unique
ON public.inventory_count_items(
  count_id,
  product_id,
  COALESCE(
    variant_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);


CREATE INDEX IF NOT EXISTS inventory_counts_branch_idx
ON public.inventory_counts(
  branch_id,
  started_at DESC
);


CREATE INDEX IF NOT EXISTS inventory_count_items_count_idx
ON public.inventory_count_items(count_id);


-- ============================================================
-- 6. RLS INVENTARIO FÍSICO
-- ============================================================

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS r_inventory_counts
ON public.inventory_counts;

DROP POLICY IF EXISTS c_inventory_counts
ON public.inventory_counts;

DROP POLICY IF EXISTS u_inventory_counts
ON public.inventory_counts;

DROP POLICY IF EXISTS r_inventory_count_items
ON public.inventory_count_items;

DROP POLICY IF EXISTS c_inventory_count_items
ON public.inventory_count_items;

DROP POLICY IF EXISTS u_inventory_count_items
ON public.inventory_count_items;


CREATE POLICY r_inventory_counts
ON public.inventory_counts
FOR SELECT
TO authenticated
USING (true);


CREATE POLICY c_inventory_counts
ON public.inventory_counts
FOR INSERT
TO authenticated
WITH CHECK (public.is_manager());


CREATE POLICY u_inventory_counts
ON public.inventory_counts
FOR UPDATE
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());


CREATE POLICY r_inventory_count_items
ON public.inventory_count_items
FOR SELECT
TO authenticated
USING (true);


CREATE POLICY c_inventory_count_items
ON public.inventory_count_items
FOR INSERT
TO authenticated
WITH CHECK (public.is_manager());


CREATE POLICY u_inventory_count_items
ON public.inventory_count_items
FOR UPDATE
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());


GRANT SELECT, INSERT, UPDATE
ON public.inventory_counts
TO authenticated;

GRANT SELECT, INSERT, UPDATE
ON public.inventory_count_items
TO authenticated;

GRANT ALL
ON public.inventory_counts,
   public.inventory_count_items
TO service_role;


-- ============================================================
-- 7. INICIAR INVENTARIO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_inventory_count(
  _branch_id uuid,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_count_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'branch not found or inactive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_counts
    WHERE branch_id = _branch_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION
      'there is already an open inventory count for this branch';
  END IF;

  INSERT INTO public.inventory_counts(
    branch_id,
    status,
    notes,
    started_by
  )
  VALUES(
    _branch_id,
    'open',
    _notes,
    uid
  )
  RETURNING id
  INTO v_count_id;


  INSERT INTO public.inventory_count_items(
    count_id,
    product_id,
    variant_id,
    system_stock,
    unit_cost
  )
  SELECT
    v_count_id,
    i.product_id,
    i.variant_id,
    i.stock,
    COALESCE(
      CASE
        WHEN i.variant_id IS NOT NULL
        THEN pv.cost_override
        ELSE NULL
      END,
      p.cost,
      0
    )
  FROM public.inventory i

  INNER JOIN public.products p
    ON p.id = i.product_id

  LEFT JOIN public.product_variants pv
    ON pv.id = i.variant_id

  WHERE i.branch_id = _branch_id;

  RETURN v_count_id;

END;
$$;


REVOKE ALL
ON FUNCTION public.start_inventory_count(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_inventory_count(uuid, text)
TO authenticated, service_role;


-- ============================================================
-- 8. REGISTRAR CONTEO DE UN PRODUCTO
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_count_item(
  _count_id uuid,
  _product_id uuid,
  _variant_id uuid,
  _physical_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _physical_stock < 0 THEN
    RAISE EXCEPTION 'physical stock cannot be negative';
  END IF;

  UPDATE public.inventory_count_items
  SET
    physical_stock = _physical_stock,
    difference = _physical_stock - system_stock,
    difference_value =
      (_physical_stock - system_stock) * unit_cost,
    counted_by = uid,
    counted_at = now()
  WHERE count_id = _count_id
    AND product_id = _product_id
    AND (
      (variant_id IS NULL AND _variant_id IS NULL)
      OR variant_id = _variant_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory count item not found';
  END IF;

END;
$$;


REVOKE ALL
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  uuid,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  uuid,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 9. COMPLETAR INVENTARIO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_count public.inventory_counts;
  r record;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT *
  INTO v_count
  FROM public.inventory_counts
  WHERE id = _count_id
  FOR UPDATE;

  IF v_count.id IS NULL THEN
    RAISE EXCEPTION 'inventory count not found';
  END IF;

  IF v_count.status <> 'open' THEN
    RAISE EXCEPTION 'inventory count is not open';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_count_items
    WHERE count_id = _count_id
      AND physical_stock IS NULL
  ) THEN
    RAISE EXCEPTION
      'all inventory items must be counted first';
  END IF;


  FOR r IN
    SELECT *
    FROM public.inventory_count_items
    WHERE count_id = _count_id
  LOOP

    UPDATE public.inventory_count_items
    SET
      difference =
        r.physical_stock - r.system_stock,

      difference_value =
        (r.physical_stock - r.system_stock)
        * r.unit_cost,

      counted_by =
        COALESCE(r.counted_by, uid),

      counted_at =
        COALESCE(r.counted_at, now())

    WHERE id = r.id;


    IF r.physical_stock <> r.system_stock THEN

      INSERT INTO public.inventory(
        branch_id,
        product_id,
        variant_id,
        stock
      )
      VALUES(
        v_count.branch_id,
        r.product_id,
        r.variant_id,
        r.physical_stock - r.system_stock
      )
      ON CONFLICT (
        branch_id,
        product_id,
        COALESCE(
          variant_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
      )
      DO UPDATE
      SET
        stock =
          public.inventory.stock
          + EXCLUDED.stock,

        updated_at = now();


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
        v_count.branch_id,
        r.product_id,
        r.variant_id,

        CASE
          WHEN r.physical_stock > r.system_stock
          THEN 'adjustment_in'::public.movement_type

          ELSE 'adjustment_out'::public.movement_type
        END,

        r.physical_stock - r.system_stock,

        _count_id,
        'inventory_count',

        CASE
          WHEN r.physical_stock > r.system_stock
          THEN 'Sobrante detectado en inventario físico'
          ELSE 'Faltante detectado en inventario físico'
        END,

        uid
      );

    END IF;

  END LOOP;


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
-- 10. AUDITORÍA
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  actor_id uuid,

  action text NOT NULL,

  table_name text NOT NULL,

  record_id text,

  old_data jsonb,

  new_data jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS audit_log_created_idx
ON public.audit_log(created_at DESC);


CREATE INDEX IF NOT EXISTS audit_log_record_idx
ON public.audit_log(
  table_name,
  record_id
);


ALTER TABLE public.audit_log
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS r_audit_log
ON public.audit_log;


CREATE POLICY r_audit_log
ON public.audit_log
FOR SELECT
TO authenticated
USING (
  public.is_manager()
);


GRANT SELECT
ON public.audit_log
TO authenticated;

GRANT ALL
ON public.audit_log
TO service_role;


-- ============================================================
-- 11. FUNCIÓN DE AUDITORÍA
-- ============================================================

CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_record_id text;
BEGIN

  IF TG_OP = 'DELETE' THEN

    v_old := to_jsonb(OLD);

    v_record_id :=
      COALESCE(
        v_old->>'id',
        v_old->>'folio'
      );

  ELSIF TG_OP = 'INSERT' THEN

    v_new := to_jsonb(NEW);

    v_record_id :=
      COALESCE(
        v_new->>'id',
        v_new->>'folio'
      );

  ELSE

    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    v_record_id :=
      COALESCE(
        v_new->>'id',
        v_new->>'folio'
      );

  END IF;


  INSERT INTO public.audit_log(
    actor_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data
  )
  VALUES(
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_old,
    v_new
  );


  RETURN COALESCE(NEW, OLD);

END;
$$;


-- ============================================================
-- 12. AUDITORÍA DE OPERACIONES IMPORTANTES
-- ============================================================

DROP TRIGGER IF EXISTS audit_sales
ON public.sales;

CREATE TRIGGER audit_sales
AFTER INSERT OR UPDATE OR DELETE
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.write_audit_log();


DROP TRIGGER IF EXISTS audit_purchases
ON public.purchases;

CREATE TRIGGER audit_purchases
AFTER INSERT OR UPDATE OR DELETE
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.write_audit_log();


DROP TRIGGER IF EXISTS audit_inventory
ON public.inventory;

CREATE TRIGGER audit_inventory
AFTER INSERT OR UPDATE OR DELETE
ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.write_audit_log();


DROP TRIGGER IF EXISTS audit_expenses
ON public.expenses;

CREATE TRIGGER audit_expenses
AFTER INSERT OR UPDATE OR DELETE
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.write_audit_log();


DROP TRIGGER IF EXISTS audit_credit_payments
ON public.credit_payments;

CREATE TRIGGER audit_credit_payments
AFTER INSERT OR UPDATE OR DELETE
ON public.credit_payments
FOR EACH ROW
EXECUTE FUNCTION public.write_audit_log();


-- ============================================================
-- 13. CREATE SALE PROFESIONAL
-- Mantiene la misma firma del POS actual.
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

  v_stock numeric(12,2);

BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;


  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'empty cart';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'branch not found or inactive';
  END IF;


  IF _discount < 0 THEN
    RAISE EXCEPTION 'discount cannot be negative';
  END IF;


  IF _payment_method = 'credit'
     AND _customer_id IS NULL THEN
    RAISE EXCEPTION
      'customer is required for credit sales';
  END IF;


  -- ----------------------------------------------------------
  -- CALCULAR TOTAL
  -- ----------------------------------------------------------

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


    SELECT COALESCE(p.tax_rate, 0)
    INTO v_rate

    FROM public.products p

    WHERE p.id =
      (it->>'product_id')::uuid;


    v_subtotal :=
      v_subtotal + v_line;


    v_tax :=
      v_tax
      +
      ROUND(
        v_line * COALESCE(v_rate, 0),
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


  IF _cash_received IS NOT NULL
     AND _payment_method = 'cash'
     AND _cash_received < v_total THEN
    RAISE EXCEPTION
      'cash received is less than sale total';
  END IF;


  -- ----------------------------------------------------------
  -- CREAR VENTA
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- ITEMS
  -- ----------------------------------------------------------

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


    -- --------------------------------------------------------
    -- COSTO REAL EN EL MOMENTO DE LA VENTA
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
    -- ITEM
    -- --------------------------------------------------------

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

      COALESCE(v_cost, 0),

      COALESCE(v_cost, 0)
      * v_qty
    );


    -- --------------------------------------------------------
    -- INVENTARIO
    -- --------------------------------------------------------

    SELECT stock
    INTO v_stock

    FROM public.inventory

    WHERE branch_id = _branch_id

      AND product_id =
        (it->>'product_id')::uuid

      AND (
        (
          variant_id IS NULL
          AND v_variant IS NULL
        )
        OR variant_id = v_variant
      )

    FOR UPDATE;


    INSERT INTO public.inventory(
      branch_id,
      product_id,
      variant_id,
      stock
    )
    VALUES(
      _branch_id,
      (it->>'product_id')::uuid,
      v_variant,
      -v_qty
    )

    ON CONFLICT(
      branch_id,
      product_id,
      COALESCE(
        variant_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    )

    DO UPDATE
    SET
      stock =
        public.inventory.stock
        - v_qty,

      updated_at = now();


    -- --------------------------------------------------------
    -- MOVIMIENTO
    -- --------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- PAGO PRINCIPAL
  -- ----------------------------------------------------------

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
-- 14. CANCELAR VENTA
-- Devuelve automáticamente mercancía al inventario.
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
    RAISE EXCEPTION 'not authenticated';
  END IF;


  SELECT *
  INTO v_sale

  FROM public.sales

  WHERE id = _sale_id

  FOR UPDATE;


  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'sale not found';
  END IF;


  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION
      'sale is already cancelled or refunded';
  END IF;


  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;


  FOR r IN

    SELECT
      product_id,
      variant_id,
      quantity

    FROM public.sale_items

    WHERE sale_id = _sale_id

  LOOP


    INSERT INTO public.inventory(
      branch_id,
      product_id,
      variant_id,
      stock
    )
    VALUES(
      v_sale.branch_id,
      r.product_id,
      r.variant_id,
      r.quantity
    )

    ON CONFLICT(
      branch_id,
      product_id,
      COALESCE(
        variant_id,
        '00000000-0000-0000-0000-000000000000'::uuid
      )
    )

    DO UPDATE
    SET
      stock =
        public.inventory.stock
        + r.quantity,

      updated_at = now();


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

      v_sale.id,
      'sale_cancel',

      COALESCE(
        _reason,
        'Cancelación de venta'
      ),

      uid
    );

  END LOOP;


  UPDATE public.sales

  SET
    status = 'cancelled',

    notes =
      COALESCE(
        notes || E'\n',
        ''
      )
      ||
      'Cancelada: '
      ||
      COALESCE(
        _reason,
        'Sin motivo'
      ),

    updated_at = now()

  WHERE id = _sale_id

  RETURNING *
  INTO v_sale;


  RETURN v_sale;

END;
$$;


REVOKE ALL
ON FUNCTION public.cancel_sale(uuid, text)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.cancel_sale(uuid, text)
TO authenticated, service_role;


-- ============================================================
-- 15. FUNCIÓN DE UTILIDAD REAL
-- ============================================================

CREATE OR REPLACE VIEW public.v_sale_profit
WITH (security_invoker = true)
AS

SELECT

  s.id AS sale_id,

  s.branch_id,

  s.folio,

  s.created_at,

  s.status,

  s.total,

  COALESCE(
    SUM(
      si.cost_total
    ),
    0
  )::numeric(12,2)
  AS cost_of_goods,

  (
    s.total
    -
    COALESCE(
      SUM(si.cost_total),
      0
    )
  )::numeric(12,2)
  AS gross_profit,

  CASE
    WHEN s.total > 0
    THEN (
      (
        s.total
        -
        COALESCE(
          SUM(si.cost_total),
          0
        )
      )
      / s.total
    ) * 100

    ELSE 0
  END::numeric(12,2)
  AS gross_margin_percent

FROM public.sales s

LEFT JOIN public.sale_items si
  ON si.sale_id = s.id

GROUP BY
  s.id;


GRANT SELECT
ON public.v_sale_profit
TO authenticated;

GRANT ALL
ON public.v_sale_profit
TO service_role;


-- ============================================================
-- 16. ÍNDICES PARA VELOCIDAD DEL POS
-- ============================================================

CREATE INDEX IF NOT EXISTS sales_branch_created_idx
ON public.sales(
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS sales_cashier_created_idx
ON public.sales(
  cashier_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS sales_customer_idx
ON public.sales(customer_id);


CREATE INDEX IF NOT EXISTS inventory_branch_product_idx
ON public.inventory(
  branch_id,
  product_id
);


CREATE INDEX IF NOT EXISTS inventory_movements_branch_created_idx
ON public.inventory_movements(
  branch_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS products_name_idx
ON public.products(name);


-- ============================================================
-- 17. SEGURIDAD DE GASTOS
-- ============================================================

ALTER TABLE public.expenses
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS expenses_all_authenticated
ON public.expenses;

DROP POLICY IF EXISTS r_expenses
ON public.expenses;

DROP POLICY IF EXISTS c_expenses
ON public.expenses;

DROP POLICY IF EXISTS u_expenses
ON public.expenses;

DROP POLICY IF EXISTS d_expenses
ON public.expenses;


CREATE POLICY r_expenses
ON public.expenses
FOR SELECT
TO authenticated
USING (true);


CREATE POLICY c_expenses
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  OR created_by IS NULL
);


CREATE POLICY u_expenses
ON public.expenses
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);


CREATE POLICY d_expenses
ON public.expenses
FOR DELETE
TO authenticated
USING (
  public.is_manager()
);


GRANT SELECT, INSERT, UPDATE, DELETE
ON public.expenses
TO authenticated;


-- ============================================================
-- 18. SEGURIDAD DE ABONOS
-- ============================================================

ALTER TABLE public.credit_payments
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS credit_payments_all_authenticated
ON public.credit_payments;

DROP POLICY IF EXISTS r_credit_payments
ON public.credit_payments;

DROP POLICY IF EXISTS c_credit_payments
ON public.credit_payments;

DROP POLICY IF EXISTS u_credit_payments
ON public.credit_payments;

DROP POLICY IF EXISTS d_credit_payments
ON public.credit_payments;


CREATE POLICY r_credit_payments
ON public.credit_payments
FOR SELECT
TO authenticated
USING (true);


CREATE POLICY c_credit_payments
ON public.credit_payments
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  OR created_by IS NULL
);


CREATE POLICY u_credit_payments
ON public.credit_payments
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
)
WITH CHECK (
  public.is_manager()
);


CREATE POLICY d_credit_payments
ON public.credit_payments
FOR DELETE
TO authenticated
USING (
  public.is_manager()
);


GRANT SELECT, INSERT, UPDATE, DELETE
ON public.credit_payments
TO authenticated;


-- ============================================================
-- 19. FUNCIÓN DE SALDO DE CLIENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_balance(
  _customer_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT
    COALESCE(
      (
        SELECT SUM(s.total)
        FROM public.sales s
        WHERE s.customer_id = _customer_id
          AND s.payment_method = 'credit'
          AND s.status = 'completed'
      ),
      0
    )
    -
    COALESCE(
      (
        SELECT SUM(cp.amount)
        FROM public.credit_payments cp
        WHERE cp.customer_id = _customer_id
      ),
      0
    );

$$;


REVOKE ALL
ON FUNCTION public.get_customer_balance(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_customer_balance(uuid)
TO authenticated, service_role;


-- ============================================================
-- 20. FUNCIÓN DE RESUMEN DE CLIENTE
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
SET search_path = public
AS $$

  SELECT

    _customer_id,

    COALESCE(
      (
        SELECT SUM(s.total)
        FROM public.sales s
        WHERE s.customer_id = _customer_id
          AND s.payment_method = 'credit'
          AND s.status = 'completed'
      ),
      0
    ),

    COALESCE(
      (
        SELECT SUM(cp.amount)
        FROM public.credit_payments cp
        WHERE cp.customer_id = _customer_id
      ),
      0
    ),

    public.get_customer_balance(_customer_id);

$$;


REVOKE ALL
ON FUNCTION public.get_customer_credit_summary(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(uuid)
TO authenticated, service_role;


-- ============================================================
-- 21. COMENTARIOS DE DOCUMENTACIÓN
-- ============================================================

COMMENT ON TABLE public.sale_payments IS
'LULA OS: desglose de pagos por venta. Permite pagos mixtos.';

COMMENT ON TABLE public.inventory_counts IS
'LULA OS: sesiones de inventario físico.';

COMMENT ON TABLE public.inventory_count_items IS
'LULA OS: detalle de conteo físico, diferencias y valor económico.';

COMMENT ON TABLE public.audit_log IS
'LULA OS: bitácora de operaciones sensibles.';

COMMENT ON COLUMN public.sale_items.unit_cost IS
'Costo del producto congelado en el momento de la venta.';

COMMENT ON COLUMN public.sale_items.cost_total IS
'Costo total histórico de la línea vendida.';


-- ============================================================
-- FIN PARTE 1/3
-- ============================================================