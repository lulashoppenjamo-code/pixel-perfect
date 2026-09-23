-- ============================================================
-- LULA OS — PARTE 3/3
-- CORE CENTRAL
--
-- 1. Inventario compartido A+B
-- 2. Catálogo público
-- 3. Motor de tienda online
-- 4. Reservas
-- 5. KPIs para CEO IA
-- 6. Alertas de negocio
-- 7. Auditoría
--
-- NO elimina tablas existentes.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CONFIGURACIÓN GLOBAL DE LULA OS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  key text NOT NULL UNIQUE,

  value jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_by uuid,

  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.system_config TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.system_config TO authenticated;

DROP POLICY IF EXISTS system_config_read
ON public.system_config;

CREATE POLICY system_config_read
ON public.system_config
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS system_config_manager
ON public.system_config;

CREATE POLICY system_config_manager
ON public.system_config
FOR ALL
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());

INSERT INTO public.system_config (key, value)
VALUES
(
  'inventory_mode',
  '{"mode":"shared","name":"Inventario Central Lula Shop"}'::jsonb
),
(
  'online_store',
  '{"enabled":true,"reserve_stock":true}'::jsonb
),
(
  'ceo_ai',
  '{"enabled":true}'::jsonb
)
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- 2. INVENTARIO CENTRAL COMPARTIDO
--
-- Una sola existencia para las dos tiendas.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  product_id uuid NOT NULL
    REFERENCES public.products(id)
    ON DELETE CASCADE,

  variant_id uuid
    REFERENCES public.product_variants(id)
    ON DELETE CASCADE,

  stock numeric(12,2) NOT NULL DEFAULT 0,

  reserved_stock numeric(12,2) NOT NULL DEFAULT 0,

  min_stock numeric(12,2) NOT NULL DEFAULT 0,

  max_stock numeric(12,2),

  created_at timestamptz NOT NULL DEFAULT now(),

  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS shared_inventory_product_idx
ON public.shared_inventory(product_id);

CREATE INDEX IF NOT EXISTS shared_inventory_low_stock_idx
ON public.shared_inventory(stock, reserved_stock);


ALTER TABLE public.shared_inventory ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.shared_inventory TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.shared_inventory TO authenticated;

DROP POLICY IF EXISTS shared_inventory_read
ON public.shared_inventory;

CREATE POLICY shared_inventory_read
ON public.shared_inventory
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS shared_inventory_manager
ON public.shared_inventory;

CREATE POLICY shared_inventory_manager
ON public.shared_inventory
FOR ALL
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());


-- ============================================================
-- 3. MIGRAR EXISTENCIA ACTUAL A INVENTARIO CENTRAL
--
-- Suma las existencias de las sucursales actuales.
-- Solo se ejecuta para productos que todavía no existen
-- en shared_inventory.
-- ============================================================

INSERT INTO public.shared_inventory (
  product_id,
  variant_id,
  stock,
  min_stock,
  max_stock
)
SELECT
  i.product_id,
  i.variant_id,
  SUM(i.stock),
  MAX(i.min_stock),
  MAX(i.max_stock)
FROM public.inventory i
GROUP BY
  i.product_id,
  i.variant_id
ON CONFLICT (product_id, variant_id)
DO NOTHING;


-- ============================================================
-- 4. DISPONIBILIDAD REAL
--
-- stock disponible = físico - reservado
-- ============================================================

CREATE OR REPLACE VIEW public.v_shared_inventory
WITH (security_invoker = true)
AS
SELECT
  si.id,
  si.product_id,
  si.variant_id,

  p.name AS product_name,
  p.sku,
  p.barcode,
  p.price,
  p.cost,
  p.image_url,
  p.emoji,
  p.is_active,

  si.stock,
  si.reserved_stock,

  GREATEST(
    si.stock - si.reserved_stock,
    0
  ) AS available_stock,

  si.min_stock,
  si.max_stock,

  CASE
    WHEN GREATEST(si.stock - si.reserved_stock, 0) <= 0
      THEN 'out_of_stock'

    WHEN si.min_stock > 0
      AND GREATEST(si.stock - si.reserved_stock, 0) <= si.min_stock
      THEN 'low_stock'

    ELSE 'ok'
  END AS stock_status

FROM public.shared_inventory si

JOIN public.products p
  ON p.id = si.product_id;


-- ============================================================
-- 5. FUNCIÓN PARA CONSULTAR STOCK CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_stock(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    GREATEST(
      COALESCE(
        (
          SELECT stock - reserved_stock
          FROM public.shared_inventory
          WHERE product_id = _product_id
            AND variant_id IS NOT DISTINCT FROM _variant_id
        ),
        0
      ),
      0
    );
$$;

GRANT EXECUTE
ON FUNCTION public.get_shared_stock(uuid,uuid)
TO authenticated, anon;


-- ============================================================
-- 6. RESERVAR INVENTARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  available numeric;
BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be greater than zero';
  END IF;

  SELECT
    stock - reserved_stock
  INTO available
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product inventory not found';
  END IF;

  IF available < _quantity THEN
    RAISE EXCEPTION
      'insufficient shared stock';
  END IF;

  UPDATE public.shared_inventory
  SET
    reserved_stock = reserved_stock + _quantity,
    updated_at = now()
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;

GRANT EXECUTE
ON FUNCTION public.reserve_shared_stock(uuid,uuid,numeric)
TO authenticated, anon;


-- ============================================================
-- 7. LIBERAR RESERVA
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN

  UPDATE public.shared_inventory
  SET
    reserved_stock =
      GREATEST(
        reserved_stock - _quantity,
        0
      ),
    updated_at = now()
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;

GRANT EXECUTE
ON FUNCTION public.release_shared_stock(uuid,uuid,numeric)
TO authenticated, anon;


-- ============================================================
-- 8. CONFIRMAR VENTA SOBRE INVENTARIO CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  available numeric;
  reserved numeric;
BEGIN

  SELECT
    stock - reserved_stock,
    reserved_stock
  INTO
    available,
    reserved
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product inventory not found';
  END IF;

  IF stock < _quantity THEN
    RAISE EXCEPTION 'insufficient physical stock';
  END IF;

  UPDATE public.shared_inventory
  SET
    stock = stock - _quantity,

    reserved_stock =
      GREATEST(
        reserved_stock - LEAST(reserved, _quantity),
        0
      ),

    updated_at = now()

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;

GRANT EXECUTE
ON FUNCTION public.consume_shared_stock(uuid,uuid,numeric)
TO authenticated;


-- ============================================================
-- 9. AJUSTE CENTRAL DE INVENTARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
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

  INSERT INTO public.shared_inventory (
    product_id,
    variant_id,
    stock
  )
  VALUES (
    _product_id,
    _variant_id,
    _quantity
  )
  ON CONFLICT (product_id, variant_id)
  DO UPDATE SET
    stock =
      public.shared_inventory.stock + _quantity,
    updated_at = now();

  INSERT INTO public.inventory_movements (
    branch_id,
    product_id,
    variant_id,
    type,
    quantity,
    notes,
    created_by
  )
  SELECT
    b.id,
    _product_id,
    _variant_id,

    CASE
      WHEN _quantity >= 0
      THEN 'adjustment_in'::public.movement_type
      ELSE 'adjustment_out'::public.movement_type
    END,

    ABS(_quantity),

    COALESCE(_notes, 'Ajuste inventario central'),

    uid

  FROM public.branches b
  LIMIT 1;

END;
$$;

GRANT EXECUTE
ON FUNCTION public.adjust_shared_stock(uuid,uuid,numeric,text)
TO authenticated;


-- ============================================================
-- 10. CATÁLOGO PÚBLICO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  store_name text NOT NULL DEFAULT 'Lula Shop',

  slug text NOT NULL DEFAULT 'lula-shop',

  description text,

  logo_url text,

  whatsapp text,

  phone text,

  address text,

  shipping_enabled boolean NOT NULL DEFAULT true,

  pickup_enabled boolean NOT NULL DEFAULT true,

  online_enabled boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.store_settings (
  store_name,
  slug
)
SELECT
  'Lula Shop',
  'lula-shop'
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_settings
);


ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.store_settings TO anon, authenticated;

DROP POLICY IF EXISTS store_settings_public_read
ON public.store_settings;

CREATE POLICY store_settings_public_read
ON public.store_settings
FOR SELECT
TO anon, authenticated
USING (online_enabled = true);

DROP POLICY IF EXISTS store_settings_manager
ON public.store_settings;

CREATE POLICY store_settings_manager
ON public.store_settings
FOR ALL
TO authenticated
USING (public.is_manager())
WITH CHECK (public.is_manager());


-- ============================================================
-- 11. PRODUCTOS PUBLICABLES
-- ============================================================

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS online_enabled boolean
NOT NULL DEFAULT true;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS online_description text;

ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS online_order integer
NOT NULL DEFAULT 0;


CREATE INDEX IF NOT EXISTS products_online_idx
ON public.products(
  online_enabled,
  is_active,
  online_order
);


-- ============================================================
-- 12. VISTA DEL CATÁLOGO ONLINE
-- ============================================================

CREATE OR REPLACE VIEW public.v_online_catalog
WITH (security_invoker = false)
AS
SELECT
  p.id,
  p.name,
  p.sku,
  p.barcode,
  p.description,
  p.online_description,
  p.category_id,
  p.price,
  p.image_url,
  p.emoji,
  p.has_variants,
  p.online_order,

  COALESCE(
    SUM(
      GREATEST(
        si.stock - si.reserved_stock,
        0
      )
    ),
    0
  ) AS available_stock

FROM public.products p

LEFT JOIN public.shared_inventory si
  ON si.product_id = p.id

WHERE
  p.is_active = true
  AND p.online_enabled = true

GROUP BY
  p.id,
  p.name,
  p.sku,
  p.barcode,
  p.description,
  p.online_description,
  p.category_id,
  p.price,
  p.image_url,
  p.emoji,
  p.has_variants,
  p.online_order;


GRANT SELECT
ON public.v_online_catalog
TO anon, authenticated;


-- ============================================================
-- 13. ESTADOS DE LA TIENDA ONLINE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.online_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id uuid NOT NULL
    REFERENCES public.online_orders(id)
    ON DELETE CASCADE,

  old_status text,

  new_status text NOT NULL,

  created_by uuid,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS online_order_events_order_idx
ON public.online_order_events(order_id, created_at DESC);


ALTER TABLE public.online_order_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.online_order_events TO authenticated;

DROP POLICY IF EXISTS online_order_events_read
ON public.online_order_events;

CREATE POLICY online_order_events_read
ON public.online_order_events
FOR SELECT
TO authenticated
USING (true);


-- ============================================================
-- 14. MÉTRICAS PARA CEO IA
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ceo_dashboard(
  _branch_id uuid DEFAULT NULL,
  _days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE

  start_date timestamptz :=
    now() - make_interval(days => GREATEST(_days, 1));

  result jsonb;

  sales_total numeric := 0;
  sales_count integer := 0;
  average_ticket numeric := 0;

  expenses_total numeric := 0;
  cost_total numeric := 0;
  gross_profit numeric := 0;

  inventory_value numeric := 0;
  low_stock_count integer := 0;
  out_stock_count integer := 0;

BEGIN

  SELECT
    COALESCE(SUM(s.total),0),
    COUNT(*)
  INTO
    sales_total,
    sales_count
  FROM public.sales s
  WHERE
    s.created_at >= start_date
    AND s.status = 'completed'
    AND (
      _branch_id IS NULL
      OR s.branch_id = _branch_id
    );

  IF sales_count > 0 THEN
    average_ticket :=
      sales_total / sales_count;
  END IF;


  SELECT
    COALESCE(SUM(e.amount),0)
  INTO expenses_total
  FROM public.expenses e
  WHERE
    e.expense_date >= start_date::date
    AND (
      _branch_id IS NULL
      OR e.branch_id = _branch_id
    );


  SELECT
    COALESCE(SUM(si.cost_total),0)
  INTO cost_total
  FROM public.sale_items si
  JOIN public.sales s
    ON s.id = si.sale_id
  WHERE
    s.created_at >= start_date
    AND s.status = 'completed'
    AND (
      _branch_id IS NULL
      OR s.branch_id = _branch_id
    );


  gross_profit :=
    sales_total - cost_total;


  SELECT
    COALESCE(
      SUM(
        si.stock * COALESCE(p.cost,0)
      ),
      0
    ),

    COUNT(*) FILTER (
      WHERE
        GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
        AND si.min_stock > 0
    ),

    COUNT(*) FILTER (
      WHERE
        GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= 0
    )

  INTO
    inventory_value,
    low_stock_count,
    out_stock_count

  FROM public.shared_inventory si

  JOIN public.products p
    ON p.id = si.product_id;


  result :=
    jsonb_build_object(

      'period_days',
      _days,

      'sales',
      jsonb_build_object(
        'total', sales_total,
        'tickets', sales_count,
        'average_ticket', average_ticket
      ),

      'cost',
      cost_total,

      'gross_profit',
      gross_profit,

      'gross_margin_percent',
      CASE
        WHEN sales_total > 0
        THEN ROUND(
          gross_profit / sales_total * 100,
          2
        )
        ELSE 0
      END,

      'expenses',
      expenses_total,

      'estimated_net_profit',
      gross_profit - expenses_total,

      'inventory',
      jsonb_build_object(
        'value', inventory_value,
        'low_stock', low_stock_count,
        'out_of_stock', out_stock_count
      )

    );

  RETURN result;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.get_ceo_dashboard(uuid,integer)
TO authenticated;


-- ============================================================
-- 15. PRODUCTOS QUE NECESITAN ATENCIÓN
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ceo_product_alerts(
  _limit integer DEFAULT 30
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric,
  min_stock numeric,
  cost numeric,
  price numeric,
  alert_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    p.id,
    p.name,
    si.stock,
    si.reserved_stock,

    GREATEST(
      si.stock - si.reserved_stock,
      0
    ),

    si.min_stock,

    p.cost,
    p.price,

    CASE
      WHEN si.stock - si.reserved_stock <= 0
        THEN 'out_of_stock'

      WHEN si.min_stock > 0
        AND si.stock - si.reserved_stock <= si.min_stock
        THEN 'low_stock'

      ELSE 'ok'
    END

  FROM public.shared_inventory si

  JOIN public.products p
    ON p.id = si.product_id

  WHERE
    p.is_active = true

  ORDER BY
    CASE
      WHEN si.stock - si.reserved_stock <= 0
        THEN 1
      WHEN si.min_stock > 0
        AND si.stock - si.reserved_stock <= si.min_stock
        THEN 2
      ELSE 3
    END,
    p.name

  LIMIT _limit;
$$;

GRANT EXECUTE
ON FUNCTION public.get_ceo_product_alerts(integer)
TO authenticated;


-- ============================================================
-- 16. TOP PRODUCTOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_top_products(
  _days integer DEFAULT 30,
  _limit integer DEFAULT 20
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  gross_profit numeric,
  margin_percent numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    si.product_id,

    MAX(si.name_snapshot),

    SUM(si.quantity),

    SUM(si.total),

    SUM(si.cost_total),

    SUM(si.total - si.cost_total),

    CASE
      WHEN SUM(si.total) > 0
      THEN
        SUM(si.total - si.cost_total)
        / SUM(si.total) * 100
      ELSE 0
    END

  FROM public.sale_items si

  JOIN public.sales s
    ON s.id = si.sale_id

  WHERE
    s.created_at >=
      now() - make_interval(days => GREATEST(_days,1))

    AND s.status = 'completed'

  GROUP BY
    si.product_id

  ORDER BY
    SUM(si.total) DESC

  LIMIT _limit;
$$;

GRANT EXECUTE
ON FUNCTION public.get_top_products(integer,integer)
TO authenticated;


-- ============================================================
-- 17. AUDITORÍA DE CAMBIOS IMPORTANTES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid,

  action text NOT NULL,

  entity_type text,

  entity_id uuid,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_audit_log_date_idx
ON public.system_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS system_audit_log_entity_idx
ON public.system_audit_log(entity_type, entity_id);

ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.system_audit_log TO authenticated;

DROP POLICY IF EXISTS audit_read
ON public.system_audit_log;

CREATE POLICY audit_read
ON public.system_audit_log
FOR SELECT
TO authenticated
USING (
  public.is_manager()
);

DROP POLICY IF EXISTS audit_insert
ON public.system_audit_log;

CREATE POLICY audit_insert
ON public.system_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR public.is_manager()
);


-- ============================================================
-- 18. FUNCIÓN DE AUDITORÍA
-- ============================================================

CREATE OR REPLACE FUNCTION public.write_system_audit(
  _action text,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  audit_id uuid;
BEGIN

  INSERT INTO public.system_audit_log (
    user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    auth.uid(),
    _action,
    _entity_type,
    _entity_id,
    COALESCE(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO audit_id;

  RETURN audit_id;

END;
$$;

GRANT EXECUTE
ON FUNCTION public.write_system_audit(text,text,uuid,jsonb)
TO authenticated;


-- ============================================================
-- 19. ÍNDICES FINALES
-- ============================================================

CREATE INDEX IF NOT EXISTS sales_created_status_idx
ON public.sales(created_at DESC, status);

CREATE INDEX IF NOT EXISTS sale_items_product_sale_idx
ON public.sale_items(product_id, sale_id);

CREATE INDEX IF NOT EXISTS expenses_date_branch_idx
ON public.expenses(expense_date DESC, branch_id);

CREATE INDEX IF NOT EXISTS credit_customer_date_idx
ON public.credit_payments(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS online_orders_status_date_idx
ON public.online_orders(status, created_at DESC);


-- ============================================================
-- 20. DOCUMENTACIÓN
-- ============================================================

COMMENT ON TABLE public.shared_inventory IS
'LULA OS: existencia central compartida entre las tiendas A+B.';

COMMENT ON VIEW public.v_shared_inventory IS
'LULA OS: existencia central disponible después de reservas.';

COMMENT ON VIEW public.v_online_catalog IS
'LULA OS: catálogo público de la tienda online.';

COMMENT ON FUNCTION public.get_ceo_dashboard(uuid,integer) IS
'LULA OS CEO: KPIs centrales del negocio.';

COMMENT ON FUNCTION public.get_ceo_product_alerts(integer) IS
'LULA OS CEO: productos sin stock o con stock bajo.';

COMMENT ON FUNCTION public.get_top_products(integer,integer) IS
'LULA OS CEO: productos con mayor facturación y utilidad.';


COMMIT;