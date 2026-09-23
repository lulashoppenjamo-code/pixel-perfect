-- ============================================================
-- LULA OS
-- PARTE 6-10 — MOTOR CENTRAL FINAL
--
-- OBJETIVO:
--
-- 1. Inventario central como única existencia operativa.
-- 2. Ajustes centrales.
-- 3. Límites centrales.
-- 4. Conteo físico central.
-- 5. Compras -> stock central.
-- 6. Devoluciones -> stock central.
-- 7. Pedidos online -> reserva central.
-- 8. Reportes basados en costo histórico.
-- 9. CEO IA con datos centrales.
-- 10. Auditoría.
--
-- NO elimina tablas antiguas.
-- NO elimina datos.
-- NO elimina inventory.
--
-- shared_inventory es la fuente única de existencia.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. CONFIGURACIÓN
-- ============================================================

INSERT INTO public.system_config(key, value)
VALUES
(
  'inventory_mode',
  jsonb_build_object(
    'mode', 'shared',
    'name', 'Inventario Central Lula Shop'
  )
),
(
  'online_store',
  jsonb_build_object(
    'enabled', true,
    'reserve_stock', true
  )
),
(
  'ceo_ai',
  jsonb_build_object(
    'enabled', true
  )
)
ON CONFLICT(key) DO UPDATE
SET
  value = EXCLUDED.value,
  updated_at = now();


-- ============================================================
-- 1. INVENTARIO CENTRAL — FUNCIÓN DE AJUSTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_shared_inventory(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _quantity numeric DEFAULT 0,
  _notes text DEFAULT NULL
)
RETURNS public.shared_inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shared_inventory;
  v_uid uuid := auth.uid();
BEGIN

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _quantity = 0 THEN
    RAISE EXCEPTION 'quantity cannot be zero';
  END IF;

  INSERT INTO public.shared_inventory(
    product_id,
    variant_id,
    stock
  )
  VALUES(
    _product_id,
    _variant_id,
    GREATEST(_quantity, 0)
  )
  ON CONFLICT(product_id, variant_id)
  DO UPDATE
  SET
    stock = public.shared_inventory.stock + _quantity,
    updated_at = now()
  RETURNING *
  INTO v_row;

  IF v_row.stock < 0 THEN
    RAISE EXCEPTION
      'stock cannot be negative';
  END IF;

  RETURN v_row;

END;
$$;


GRANT EXECUTE ON FUNCTION public.adjust_shared_inventory(
  uuid,
  uuid,
  numeric,
  text
)
TO authenticated;


-- ============================================================
-- 2. COMPATIBILIDAD CON adjust_stock()
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

  PERFORM public.adjust_shared_inventory(
    _product_id,
    _variant_id,
    _quantity,
    COALESCE(
      _notes,
      'Ajuste de inventario'
    )
  );

END;
$$;


GRANT EXECUTE ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
TO authenticated;


-- ============================================================
-- 3. LÍMITES CENTRALES
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_shared_inventory_limits(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _min_stock numeric DEFAULT 0,
  _max_stock numeric DEFAULT NULL
)
RETURNS public.shared_inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shared_inventory;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _min_stock < 0 THEN
    RAISE EXCEPTION 'minimum stock cannot be negative';
  END IF;

  IF _max_stock IS NOT NULL
     AND _max_stock < _min_stock
  THEN
    RAISE EXCEPTION
      'maximum stock cannot be lower than minimum stock';
  END IF;

  INSERT INTO public.shared_inventory(
    product_id,
    variant_id,
    stock,
    min_stock,
    max_stock
  )
  VALUES(
    _product_id,
    _variant_id,
    0,
    _min_stock,
    _max_stock
  )
  ON CONFLICT(product_id, variant_id)
  DO UPDATE
  SET
    min_stock = EXCLUDED.min_stock,
    max_stock = EXCLUDED.max_stock,
    updated_at = now()
  RETURNING *
  INTO v_row;

  RETURN v_row;

END;
$$;


GRANT EXECUTE ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated;


-- ============================================================
-- 4. COMPATIBILIDAD CON set_inventory_limits()
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_inventory_limits(
  _branch_id uuid,
  _product_id uuid,
  _min_stock numeric,
  _max_stock numeric DEFAULT NULL,
  _variant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  PERFORM public.set_shared_inventory_limits(
    _product_id,
    _variant_id,
    _min_stock,
    _max_stock
  );

END;
$$;


GRANT EXECUTE ON FUNCTION public.set_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric,
  uuid
)
TO authenticated;


-- ============================================================
-- 5. CONSULTA CENTRAL COMPLETA
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_inventory()
RETURNS TABLE(
  id uuid,
  product_id uuid,
  variant_id uuid,
  product_name text,
  sku text,
  barcode text,
  price numeric,
  cost numeric,
  image_url text,
  emoji text,
  is_active boolean,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric,
  min_stock numeric,
  max_stock numeric,
  stock_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.product_id,
    v.variant_id,
    v.product_name,
    v.sku,
    v.barcode,
    v.price,
    v.cost,
    v.image_url,
    v.emoji,
    v.is_active,
    v.stock,
    v.reserved_stock,
    v.available_stock,
    v.min_stock,
    v.max_stock,
    v.stock_status
  FROM public.v_shared_inventory v
  WHERE v.is_active = true
  ORDER BY v.product_name;
$$;


GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated, anon;


-- ============================================================
-- 6. STOCK DISPONIBLE DE PRODUCTO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_product_stock(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  variant_id uuid,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    si.product_id,
    si.variant_id,
    si.stock,
    si.reserved_stock,
    GREATEST(
      si.stock - si.reserved_stock,
      0
    ) AS available_stock
  FROM public.shared_inventory si
  WHERE si.product_id = _product_id
    AND si.variant_id IS NOT DISTINCT FROM _variant_id
  LIMIT 1;
$$;


GRANT EXECUTE
ON FUNCTION public.get_shared_product_stock(uuid, uuid)
TO authenticated, anon;


-- ============================================================
-- 7. RESERVA DE STOCK
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available numeric;
BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid reservation quantity';
  END IF;

  SELECT
    GREATEST(
      stock - reserved_stock,
      0
    )
  INTO v_available
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory record not found';
  END IF;

  IF v_available < _quantity THEN
    RAISE EXCEPTION
      'insufficient stock for reservation';
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
ON FUNCTION public.reserve_shared_stock(uuid, uuid, numeric)
TO authenticated, anon;


-- ============================================================
-- 8. LIBERAR RESERVA
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid release quantity';
  END IF;

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory record not found';
  END IF;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.release_shared_stock(uuid, uuid, numeric)
TO authenticated, anon;


-- ============================================================
-- 9. CONSUMIR STOCK
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available numeric;
BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid quantity';
  END IF;

  SELECT
    GREATEST(
      stock - reserved_stock,
      0
    )
  INTO v_available
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'shared inventory record not found';
  END IF;

  IF v_available < _quantity THEN
    RAISE EXCEPTION
      'insufficient shared stock';
  END IF;

  UPDATE public.shared_inventory
  SET
    stock = stock - _quantity,
    updated_at = now()
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.consume_shared_stock(uuid, uuid, numeric)
TO authenticated, anon;


-- ============================================================
-- 10. DEVOLUCIÓN DIRECTA AL INVENTARIO
-- ============================================================

CREATE OR REPLACE FUNCTION public.return_shared_stock(
  _product_id uuid,
  _variant_id uuid,
  _quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid quantity';
  END IF;

  INSERT INTO public.shared_inventory(
    product_id,
    variant_id,
    stock
  )
  VALUES(
    _product_id,
    _variant_id,
    _quantity
  )
  ON CONFLICT(product_id, variant_id)
  DO UPDATE
  SET
    stock =
      public.shared_inventory.stock
      + EXCLUDED.stock,
    updated_at = now();

END;
$$;


GRANT EXECUTE
ON FUNCTION public.return_shared_stock(uuid, uuid, numeric)
TO authenticated;


-- ============================================================
-- 11. CANCELACIÓN DE VENTA
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
  v_sale public.sales;
  v_item record;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale not found';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION
      'sale is not in completed status';
  END IF;

  IF v_sale.cashier_id <> auth.uid()
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  FOR v_item IN
    SELECT
      product_id,
      variant_id,
      quantity
    FROM public.sale_items
    WHERE sale_id = _sale_id
  LOOP

    PERFORM public.return_shared_stock(
      v_item.product_id,
      v_item.variant_id,
      v_item.quantity
    );

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
      v_item.product_id,
      v_item.variant_id,
      'return',
      v_item.quantity,
      _sale_id,
      'sale',
      COALESCE(
        _reason,
        'Cancelación de venta'
      ),
      auth.uid()
    );

  END LOOP;

  UPDATE public.sales
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE id = _sale_id
  RETURNING *
  INTO v_sale;

  RETURN v_sale;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.cancel_sale(uuid, text)
TO authenticated;


-- ============================================================
-- 12. STOCK PARA CUALQUIER MÓDULO LEGACY
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
ON FUNCTION public.available_stock(uuid, uuid, uuid)
TO authenticated;


-- ============================================================
-- 13. CONTEO FÍSICO CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_shared_physical_count(
  _product_id uuid,
  _variant_id uuid,
  _counted_stock numeric,
  _notes text DEFAULT NULL
)
RETURNS public.shared_inventory
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current numeric;
  v_delta numeric;
  v_row public.shared_inventory;
BEGIN

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _counted_stock < 0 THEN
    RAISE EXCEPTION 'count cannot be negative';
  END IF;

  SELECT stock
  INTO v_current
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN

    INSERT INTO public.shared_inventory(
      product_id,
      variant_id,
      stock
    )
    VALUES(
      _product_id,
      _variant_id,
      _counted_stock
    )
    RETURNING *
    INTO v_row;

    v_delta := _counted_stock;

  ELSE

    v_delta :=
      _counted_stock - v_current;

    UPDATE public.shared_inventory
    SET
      stock = _counted_stock,
      updated_at = now()
    WHERE product_id = _product_id
      AND variant_id IS NOT DISTINCT FROM _variant_id
    RETURNING *
    INTO v_row;

  END IF;

  IF v_delta <> 0 THEN

    INSERT INTO public.inventory_movements(
      branch_id,
      product_id,
      variant_id,
      type,
      quantity,
      notes,
      created_by
    )
    VALUES(
      (
        SELECT id
        FROM public.branches
        WHERE is_active = true
        ORDER BY created_at
        LIMIT 1
      ),
      _product_id,
      _variant_id,
      CASE
        WHEN v_delta > 0
        THEN 'adjustment_in'
        ELSE 'adjustment_out'
      END,
      v_delta,
      COALESCE(
        _notes,
        'Conteo físico central'
      ),
      auth.uid()
    );

  END IF;

  RETURN v_row;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.apply_shared_physical_count(
  uuid,
  uuid,
  numeric,
  text
)
TO authenticated;


-- ============================================================
-- 14. RESUMEN DE INVENTARIO PARA CEO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_inventory_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'products',
    COUNT(*),

    'units',
    COALESCE(
      SUM(stock),
      0
    ),

    'reserved',
    COALESCE(
      SUM(reserved_stock),
      0
    ),

    'available',
    COALESCE(
      SUM(
        GREATEST(
          stock - reserved_stock,
          0
        )
      ),
      0
    ),

    'inventory_cost',
    COALESCE(
      SUM(stock * cost),
      0
    ),

    'inventory_retail',
    COALESCE(
      SUM(stock * price),
      0
    ),

    'low_stock',
    COUNT(*) FILTER(
      WHERE
        GREATEST(
          stock - reserved_stock,
          0
        ) <= min_stock
    ),

    'out_of_stock',
    COUNT(*) FILTER(
      WHERE
        GREATEST(
          stock - reserved_stock,
          0
        ) <= 0
    )
  )
  FROM public.v_shared_inventory;
$$;


GRANT EXECUTE
ON FUNCTION public.get_inventory_kpis()
TO authenticated;


-- ============================================================
-- 15. TOP PRODUCTOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_top_products(
  _from timestamptz DEFAULT now() - interval '30 days',
  _to timestamptz DEFAULT now(),
  _limit integer DEFAULT 20
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  profit numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    si.product_id,
    MAX(si.name_snapshot),
    SUM(si.quantity),
    SUM(si.total),
    SUM(
      COALESCE(
        si.cost_total,
        si.unit_cost * si.quantity,
        0
      )
    ),
    SUM(si.total)
      -
    SUM(
      COALESCE(
        si.cost_total,
        si.unit_cost * si.quantity,
        0
      )
    )
  FROM public.sale_items si
  JOIN public.sales s
    ON s.id = si.sale_id
  WHERE s.status = 'completed'
    AND s.created_at >= _from
    AND s.created_at < _to
  GROUP BY si.product_id
  ORDER BY SUM(si.quantity) DESC
  LIMIT GREATEST(_limit, 1);
$$;


GRANT EXECUTE
ON FUNCTION public.get_top_products(
  timestamptz,
  timestamptz,
  integer
)
TO authenticated;


-- ============================================================
-- 16. RENTABILIDAD DEL PERIODO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_sales_profit_summary(
  _from timestamptz,
  _to timestamptz,
  _branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(

    'sales',
    COUNT(DISTINCT s.id),

    'revenue',
    COALESCE(
      SUM(si.total),
      0
    ),

    'cost',
    COALESCE(
      SUM(
        COALESCE(
          si.cost_total,
          si.unit_cost * si.quantity,
          0
        )
      ),
      0
    ),

    'profit',
    COALESCE(
      SUM(si.total),
      0
    )
    -
    COALESCE(
      SUM(
        COALESCE(
          si.cost_total,
          si.unit_cost * si.quantity,
          0
        )
      ),
      0
    ),

    'margin_percent',
    CASE
      WHEN COALESCE(SUM(si.total), 0) = 0
      THEN 0

      ELSE
        (
          (
            COALESCE(SUM(si.total), 0)
            -
            COALESCE(
              SUM(
                COALESCE(
                  si.cost_total,
                  si.unit_cost * si.quantity,
                  0
                )
              ),
              0
            )
          )
          /
          SUM(si.total)
        ) * 100
    END

  )
  FROM public.sales s
  JOIN public.sale_items si
    ON si.sale_id = s.id
  WHERE s.status = 'completed'
    AND s.created_at >= _from
    AND s.created_at < _to
    AND (
      _branch_id IS NULL
      OR s.branch_id = _branch_id
    );
$$;


GRANT EXECUTE
ON FUNCTION public.get_sales_profit_summary(
  timestamptz,
  timestamptz,
  uuid
)
TO authenticated;


-- ============================================================
-- 17. CEO DASHBOARD CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ceo_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_start timestamptz;
  v_month_start timestamptz;
  v_previous_month_start timestamptz;
  v_previous_month_end timestamptz;

  v_today jsonb;
  v_month jsonb;
  v_previous jsonb;
  v_inventory jsonb;
BEGIN

  v_today_start :=
    date_trunc(
      'day',
      now()
    );

  v_month_start :=
    date_trunc(
      'month',
      now()
    );

  v_previous_month_start :=
    v_month_start - interval '1 month';

  v_previous_month_end :=
    v_month_start;

  SELECT public.get_sales_profit_summary(
    v_today_start,
    now(),
    NULL
  )
  INTO v_today;

  SELECT public.get_sales_profit_summary(
    v_month_start,
    now(),
    NULL
  )
  INTO v_month;

  SELECT public.get_sales_profit_summary(
    v_previous_month_start,
    v_previous_month_end,
    NULL
  )
  INTO v_previous;

  SELECT public.get_inventory_kpis()
  INTO v_inventory;

  RETURN jsonb_build_object(

    'generated_at',
    now(),

    'today',
    v_today,

    'month',
    v_month,

    'previous_month',
    v_previous,

    'inventory',
    v_inventory

  );

END;
$$;


GRANT EXECUTE
ON FUNCTION public.get_ceo_dashboard()
TO authenticated;


-- ============================================================
-- 18. ALERTAS CEO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ceo_product_alerts()
RETURNS TABLE(
  product_id uuid,
  product_name text,
  stock numeric,
  available_stock numeric,
  min_stock numeric,
  price numeric,
  cost numeric,
  alert_type text,
  priority integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    product_id,
    product_name,
    stock,
    available_stock,
    min_stock,
    price,
    cost,

    CASE
      WHEN available_stock <= 0
        THEN 'out_of_stock'

      WHEN available_stock <= min_stock
        THEN 'low_stock'

      ELSE 'ok'
    END,

    CASE
      WHEN available_stock <= 0
        THEN 1

      WHEN available_stock <= min_stock
        THEN 2

      ELSE 3
    END

  FROM public.v_shared_inventory
  WHERE is_active = true
    AND available_stock <= min_stock
  ORDER BY
    priority,
    product_name;
$$;


GRANT EXECUTE
ON FUNCTION public.get_ceo_product_alerts()
TO authenticated;


-- ============================================================
-- 19. AUDITORÍA DEL SISTEMA
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid,

  action text NOT NULL,

  entity_type text,

  entity_id uuid,

  branch_id uuid,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS
system_audit_log_created_idx
ON public.system_audit_log(created_at DESC);


CREATE INDEX IF NOT EXISTS
system_audit_log_entity_idx
ON public.system_audit_log(entity_type, entity_id);


ALTER TABLE public.system_audit_log
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS system_audit_read
ON public.system_audit_log;


CREATE POLICY system_audit_read
ON public.system_audit_log
FOR SELECT
TO authenticated
USING(
  public.is_manager()
);


CREATE OR REPLACE FUNCTION public.write_system_audit(
  _action text,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _branch_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.system_audit_log(
    user_id,
    action,
    entity_type,
    entity_id,
    branch_id,
    metadata
  )
  VALUES(
    auth.uid(),
    _action,
    _entity_type,
    _entity_id,
    _branch_id,
    COALESCE(_metadata, '{}'::jsonb)
  );
$$;


GRANT EXECUTE
ON FUNCTION public.write_system_audit(
  text,
  text,
  uuid,
  uuid,
  jsonb
)
TO authenticated;


-- ============================================================
-- 20. ÍNDICES FINALES
-- ============================================================

CREATE INDEX IF NOT EXISTS
shared_inventory_product_variant_idx
ON public.shared_inventory(
  product_id,
  variant_id
);

CREATE INDEX IF NOT EXISTS
shared_inventory_available_idx
ON public.shared_inventory(
  stock,
  reserved_stock
);

CREATE INDEX IF NOT EXISTS
sale_items_product_idx
ON public.sale_items(product_id);

CREATE INDEX IF NOT EXISTS
sales_created_status_idx
ON public.sales(created_at, status);

CREATE INDEX IF NOT EXISTS
sales_branch_created_idx
ON public.sales(branch_id, created_at);

CREATE INDEX IF NOT EXISTS
inventory_movements_product_created_idx
ON public.inventory_movements(
  product_id,
  created_at DESC
);


-- ============================================================
-- 21. COMENTARIOS DE ARQUITECTURA
-- ============================================================

COMMENT ON TABLE public.shared_inventory IS
'Fuente única de existencia física de Lula OS. Compartida entre todas las sucursales.';

COMMENT ON TABLE public.inventory IS
'Tabla legacy/histórica. No debe utilizarse como fuente operativa de stock.';

COMMENT ON FUNCTION public.get_shared_inventory() IS
'Catálogo operativo del inventario central.';

COMMENT ON FUNCTION public.get_shared_product_stock(uuid,uuid) IS
'Consulta de existencia disponible central por producto/variante.';

COMMENT ON FUNCTION public.get_ceo_dashboard() IS
'KPIs centrales de Lula OS para el módulo CEO IA.';

COMMIT;