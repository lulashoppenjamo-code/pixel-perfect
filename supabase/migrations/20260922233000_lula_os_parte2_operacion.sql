-- ============================================================
-- LULA OS — PARTE 2/3
-- MOTOR OPERATIVO PROFESIONAL
--
-- NO elimina datos.
-- NO reemplaza tablas existentes.
-- Compatible con el esquema actual de pixel-perfect.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. COSTO HISTÓRICO DE LAS VENTAS
-- ============================================================

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS cost_total numeric(12,2) NOT NULL DEFAULT 0;

-- Para ventas anteriores, intenta reconstruir el costo actual.
UPDATE public.sale_items si
SET
  unit_cost = COALESCE(
    pv.cost_override,
    p.cost,
    0
  ),
  cost_total = COALESCE(
    si.quantity * COALESCE(pv.cost_override, p.cost, 0),
    0
  )
FROM public.products p
LEFT JOIN public.product_variants pv
  ON pv.id = si.variant_id
WHERE si.product_id = p.id
  AND COALESCE(si.unit_cost, 0) = 0;


-- ============================================================
-- 2. PAGOS DE UNA VENTA
-- Permite efectivo + tarjeta + transferencia + crédito.
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

CREATE INDEX IF NOT EXISTS sale_payments_created_idx
  ON public.sale_payments(created_at DESC);

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.sale_payments TO authenticated;
GRANT ALL ON public.sale_payments TO service_role;

DROP POLICY IF EXISTS sale_payments_read
ON public.sale_payments;

CREATE POLICY sale_payments_read
ON public.sale_payments
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS sale_payments_insert
ON public.sale_payments;

CREATE POLICY sale_payments_insert
ON public.sale_payments
FOR INSERT
TO authenticated
WITH CHECK (
  created_by IS NULL
  OR created_by = auth.uid()
  OR public.is_manager()
);


-- ============================================================
-- 3. REGISTRAR PAGOS DE UNA VENTA
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_sale_payments(
  _sale_id uuid,
  _payments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();
  sale_total numeric;
  payment_total numeric;
  p jsonb;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT total
  INTO sale_total
  FROM public.sales
  WHERE id = _sale_id;

  IF sale_total IS NULL THEN
    RAISE EXCEPTION 'sale not found';
  END IF;

  payment_total := 0;

  FOR p IN
    SELECT *
    FROM jsonb_array_elements(_payments)
  LOOP

    IF COALESCE((p->>'amount')::numeric, 0) <= 0 THEN
      CONTINUE;
    END IF;

    payment_total :=
      payment_total + (p->>'amount')::numeric;

  END LOOP;

  IF ABS(payment_total - sale_total) > 0.01 THEN
    RAISE EXCEPTION
      'payment total (%) does not match sale total (%)',
      payment_total,
      sale_total;
  END IF;

  DELETE FROM public.sale_payments
  WHERE sale_id = _sale_id;

  FOR p IN
    SELECT *
    FROM jsonb_array_elements(_payments)
  LOOP

    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      reference,
      created_by
    )
    VALUES (
      _sale_id,
      (p->>'payment_method')::public.payment_method,
      (p->>'amount')::numeric,
      NULLIF(p->>'reference', ''),
      uid
    );

  END LOOP;

END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_payments(uuid, jsonb)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.record_sale_payments(uuid, jsonb)
TO authenticated;


-- ============================================================
-- 4. INVENTARIO FÍSICO PROFESIONAL
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  branch_id uuid NOT NULL
    REFERENCES public.branches(id)
    ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','counting','completed','cancelled')),

  notes text,

  started_by uuid,

  completed_by uuid,

  started_at timestamptz NOT NULL DEFAULT now(),

  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  count_id uuid NOT NULL
    REFERENCES public.inventory_counts(id)
    ON DELETE CASCADE,

  product_id uuid NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  variant_id uuid
    REFERENCES public.product_variants(id)
    ON DELETE SET NULL,

  system_stock numeric(12,2) NOT NULL DEFAULT 0,

  counted_stock numeric(12,2),

  difference numeric(12,2),

  unit_cost numeric(12,2) NOT NULL DEFAULT 0,

  difference_value numeric(12,2) NOT NULL DEFAULT 0,

  counted_at timestamptz,

  UNIQUE(count_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS inventory_counts_branch_idx
ON public.inventory_counts(branch_id);

CREATE INDEX IF NOT EXISTS inventory_count_items_count_idx
ON public.inventory_count_items(count_id);

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON
  public.inventory_counts,
  public.inventory_count_items
TO authenticated;

GRANT ALL ON
  public.inventory_counts,
  public.inventory_count_items
TO service_role;

DROP POLICY IF EXISTS inventory_counts_read
ON public.inventory_counts;

CREATE POLICY inventory_counts_read
ON public.inventory_counts
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS inventory_counts_manager
ON public.inventory_counts;

CREATE POLICY inventory_counts_manager
ON public.inventory_counts
FOR ALL
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS inventory_count_items_read
ON public.inventory_count_items;

CREATE POLICY inventory_count_items_read
ON public.inventory_count_items
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS inventory_count_items_manager
ON public.inventory_count_items;

CREATE POLICY inventory_count_items_manager
ON public.inventory_count_items
FOR ALL
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());


-- ============================================================
-- 5. INICIAR INVENTARIO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.start_inventory_count(
  _branch_id uuid,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();
  count_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
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
  RETURNING id INTO count_id;

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
    i.product_id,
    i.variant_id,
    i.stock,
    NULL,
    COALESCE(
      pv.cost_override,
      p.cost,
      0
    )
  FROM public.inventory i
  JOIN public.products p
    ON p.id = i.product_id
  LEFT JOIN public.product_variants pv
    ON pv.id = i.variant_id
  WHERE i.branch_id = _branch_id;

  RETURN count_id;

END;
$$;

REVOKE ALL ON FUNCTION public.start_inventory_count(uuid,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_inventory_count(uuid,text)
TO authenticated;


-- ============================================================
-- 6. CAPTURAR CONTEO FÍSICO
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_count_item(
  _count_id uuid,
  _item_id uuid,
  _counted_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_system numeric;
  v_cost numeric;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT
    system_stock,
    unit_cost
  INTO
    v_system,
    v_cost
  FROM public.inventory_count_items
  WHERE id = _item_id
    AND count_id = _count_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory count item not found';
  END IF;

  IF _counted_stock < 0 THEN
    RAISE EXCEPTION 'counted stock cannot be negative';
  END IF;

  UPDATE public.inventory_count_items
  SET
    counted_stock = _counted_stock,
    difference = _counted_stock - v_system,
    difference_value =
      (_counted_stock - v_system) * v_cost,
    counted_at = now()
  WHERE id = _item_id
    AND count_id = _count_id;

END;
$$;

REVOKE ALL ON FUNCTION public.set_inventory_count_item(uuid,uuid,numeric)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_inventory_count_item(uuid,uuid,numeric)
TO authenticated;


-- ============================================================
-- 7. CERRAR INVENTARIO FÍSICO
-- Genera movimientos de ajuste.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_inventory_count(
  _count_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();

  c public.inventory_counts;

  item record;

  diff numeric;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT *
  INTO c
  FROM public.inventory_counts
  WHERE id = _count_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory count not found';
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
  ) THEN
    RAISE EXCEPTION
      'there are products without physical count';
  END IF;

  FOR item IN
    SELECT *
    FROM public.inventory_count_items
    WHERE count_id = _count_id
  LOOP

    diff :=
      item.counted_stock - item.system_stock;

    IF ABS(diff) > 0.000001 THEN

      UPDATE public.inventory
      SET
        stock = item.counted_stock,
        updated_at = now()
      WHERE branch_id = c.branch_id
        AND product_id = item.product_id
        AND COALESCE(variant_id,
          '00000000-0000-0000-0000-000000000000'
          ::uuid
        )
        =
        COALESCE(item.variant_id,
          '00000000-0000-0000-0000-000000000000'
          ::uuid
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
        c.branch_id,
        item.product_id,
        item.variant_id,

        CASE
          WHEN diff > 0
          THEN 'adjustment_in'
          ELSE 'adjustment_out'
        END,

        ABS(diff),

        _count_id,
        'inventory_count',

        CASE
          WHEN diff > 0
          THEN 'Sobrante de inventario físico'
          ELSE 'Faltante de inventario físico'
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

REVOKE ALL ON FUNCTION public.complete_inventory_count(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(uuid)
TO authenticated;


-- ============================================================
-- 8. ESTADO DE CUENTA DEL CLIENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_balance(
  _customer_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(s.total)
      FROM public.sales s
      WHERE s.customer_id = _customer_id
        AND s.payment_method = 'credit'
        AND s.status IN ('completed','partially_refunded')
    ), 0)
    -
    COALESCE((
      SELECT SUM(cp.amount)
      FROM public.credit_payments cp
      WHERE cp.customer_id = _customer_id
    ), 0);
$$;

GRANT EXECUTE
ON FUNCTION public.get_customer_balance(uuid)
TO authenticated;


-- ============================================================
-- 9. RESUMEN DE CRÉDITO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_credit_summary(
  _customer_id uuid
)
RETURNS TABLE (
  customer_id uuid,
  credit_sales numeric,
  payments numeric,
  balance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    _customer_id,

    COALESCE((
      SELECT SUM(s.total)
      FROM public.sales s
      WHERE s.customer_id = _customer_id
        AND s.payment_method = 'credit'
        AND s.status IN ('completed','partially_refunded')
    ), 0),

    COALESCE((
      SELECT SUM(cp.amount)
      FROM public.credit_payments cp
      WHERE cp.customer_id = _customer_id
    ), 0),

    public.get_customer_balance(_customer_id);
$$;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(uuid)
TO authenticated;


-- ============================================================
-- 10. UTILIDAD REAL POR VENTA
-- ============================================================

CREATE OR REPLACE VIEW public.v_sale_profit
WITH (security_invoker = true)
AS
SELECT
  s.id AS sale_id,
  s.folio,
  s.branch_id,
  s.customer_id,
  s.cashier_id,
  s.status,
  s.created_at,

  s.total AS revenue,

  COALESCE(
    SUM(si.cost_total),
    0
  ) AS cost,

  s.total -
  COALESCE(
    SUM(si.cost_total),
    0
  ) AS gross_profit,

  CASE
    WHEN s.total > 0
    THEN (
      (
        s.total -
        COALESCE(SUM(si.cost_total), 0)
      )
      / s.total
    ) * 100
    ELSE 0
  END AS margin_percent

FROM public.sales s

LEFT JOIN public.sale_items si
  ON si.sale_id = s.id

GROUP BY
  s.id,
  s.folio,
  s.branch_id,
  s.customer_id,
  s.cashier_id,
  s.status,
  s.created_at,
  s.total;


-- ============================================================
-- 11. ÍNDICES PARA EL MOTOR
-- ============================================================

CREATE INDEX IF NOT EXISTS sales_branch_date_idx
ON public.sales(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_customer_idx
ON public.sales(customer_id);

CREATE INDEX IF NOT EXISTS sales_status_idx
ON public.sales(status);

CREATE INDEX IF NOT EXISTS sale_items_sale_idx
ON public.sale_items(sale_id);

CREATE INDEX IF NOT EXISTS sale_items_product_idx
ON public.sale_items(product_id);

CREATE INDEX IF NOT EXISTS inventory_product_branch_idx
ON public.inventory(branch_id, product_id);

CREATE INDEX IF NOT EXISTS inventory_movements_product_date_idx
ON public.inventory_movements(
  product_id,
  created_at DESC
);


-- ============================================================
-- 12. DOCUMENTACIÓN INTERNA
-- ============================================================

COMMENT ON TABLE public.sale_payments IS
'LULA OS: pagos individuales de una venta. Permite pagos mixtos.';

COMMENT ON COLUMN public.sale_items.unit_cost IS
'LULA OS: costo histórico congelado al momento de vender.';

COMMENT ON COLUMN public.sale_items.cost_total IS
'LULA OS: costo histórico total de la línea.';

COMMENT ON TABLE public.inventory_counts IS
'LULA OS: sesiones de inventario físico.';

COMMENT ON TABLE public.inventory_count_items IS
'LULA OS: detalle del conteo físico y diferencias en unidades/pesos.';

COMMENT ON VIEW public.v_sale_profit IS
'LULA OS: utilidad bruta utilizando costo histórico de cada venta.';


COMMIT;