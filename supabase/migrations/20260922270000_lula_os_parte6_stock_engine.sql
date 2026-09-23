-- ============================================================
-- LULA OS — PARTE 6
-- MOTOR DEFINITIVO DE INVENTARIO CENTRAL
--
-- shared_inventory = FUENTE ÚNICA DE EXISTENCIA
--
-- Corrige:
-- 1. Duplicados de productos sin variante
-- 2. Ajustes
-- 3. Entradas
-- 4. Salidas
-- 5. Devoluciones
-- 6. Reservas
-- 7. Límites mínimo/máximo
-- 8. Inventario físico
-- 9. KPIs de inventario
--
-- NO elimina public.inventory.
-- NO rompe las firmas existentes.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. LIMPIAR DUPLICADOS DEL INVENTARIO CENTRAL
--
-- El UNIQUE(product_id, variant_id) original permite múltiples
-- filas cuando variant_id IS NULL.
--
-- Conservamos una sola fila por:
--
-- producto + variante
--
-- considerando NULL = sin variante.
-- ============================================================

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        product_id,
        variant_id
      ORDER BY
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.shared_inventory
)
DELETE FROM public.shared_inventory si
USING ranked r
WHERE si.id = r.id
  AND r.rn > 1;


-- ============================================================
-- 2. ÍNDICE ÚNICO REAL
--
-- Este sí considera NULL como una misma variante.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS
shared_inventory_product_variant_unique
ON public.shared_inventory (
  product_id,
  COALESCE(
    variant_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);


-- ============================================================
-- 3. ÍNDICES OPERATIVOS
-- ============================================================

CREATE INDEX IF NOT EXISTS
shared_inventory_product_stock_idx
ON public.shared_inventory (
  product_id,
  stock
);

CREATE INDEX IF NOT EXISTS
shared_inventory_available_idx
ON public.shared_inventory (
  product_id,
  reserved_stock,
  stock
);


-- ============================================================
-- 4. AJUSTE DE INVENTARIO CENTRAL
--
-- Mantiene la firma que ya usa Parte 3/4.
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
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();

  v_existing_id uuid;

  v_branch_id uuid;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _quantity = 0 THEN
    RETURN;
  END IF;


  -- Bloqueo lógico por producto/variante.
  -- Evita que dos ajustes simultáneos creen filas duplicadas.

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


  SELECT id
  INTO v_existing_id
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  LIMIT 1
  FOR UPDATE;


  IF v_existing_id IS NULL THEN

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock
    )
    VALUES (
      _product_id,
      _variant_id,
      _quantity
    );

  ELSE

    UPDATE public.shared_inventory
    SET
      stock = stock + _quantity,
      updated_at = now()
    WHERE id = v_existing_id;

  END IF;


  -- Registrar movimiento usando una sucursal únicamente
  -- como contexto histórico.
  --
  -- El movimiento NO determina el stock real.

  SELECT id
  INTO v_branch_id
  FROM public.branches
  ORDER BY id
  LIMIT 1;


  IF v_branch_id IS NOT NULL THEN

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
      v_branch_id,
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
        _notes,
        'Ajuste de inventario central'
      ),

      uid
    );

  END IF;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.adjust_shared_stock(
  uuid,
  uuid,
  numeric,
  text
)
TO authenticated;


-- ============================================================
-- 5. LÍMITES DE INVENTARIO CENTRAL
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
SET search_path = public
AS $$
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
      min_stock,
      max_stock
    )
    VALUES (
      _product_id,
      _variant_id,
      0,
      _min_stock,
      _max_stock
    );

  END IF;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated;


-- ============================================================
-- 6. COMPATIBILIDAD CON INVENTARIO ANTIGUO
--
-- El frontend existente puede seguir llamando
-- set_inventory_limits().
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
-- 7. CONSUMIR INVENTARIO
--
-- Usado por ventas.
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

  v_stock numeric;
  v_reserved numeric;

BEGIN

  IF _quantity <= 0 THEN
    RAISE EXCEPTION
      'quantity must be greater than zero';
  END IF;


  SELECT
    stock,
    reserved_stock

  INTO
    v_stock,
    v_reserved

  FROM public.shared_inventory

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'product inventory not found';
  END IF;


  IF v_stock < _quantity THEN
    RAISE EXCEPTION
      'insufficient physical stock';
  END IF;


  UPDATE public.shared_inventory

  SET

    stock =
      stock - _quantity,

    reserved_stock =
      GREATEST(
        reserved_stock
        - LEAST(
            reserved_stock,
            _quantity
          ),
        0
      ),

    updated_at = now()

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.consume_shared_stock(
  uuid,
  uuid,
  numeric
)
TO authenticated;


-- ============================================================
-- 8. DEVOLVER INVENTARIO
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
    RAISE EXCEPTION
      'quantity must be greater than zero';
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

    stock =
      stock + _quantity,

    updated_at = now()

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;


  IF NOT FOUND THEN

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock
    )
    VALUES (
      _product_id,
      _variant_id,
      _quantity
    );

  END IF;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.return_shared_stock(
  uuid,
  uuid,
  numeric
)
TO authenticated;


-- ============================================================
-- 9. STOCK DISPONIBLE
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
-- 10. RESERVA ONLINE — VALIDACIÓN
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
    RAISE EXCEPTION
      'quantity must be greater than zero';
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
      'product inventory not found';
  END IF;


  IF v_available < _quantity THEN
    RAISE EXCEPTION
      'insufficient shared stock';
  END IF;


  UPDATE public.shared_inventory

  SET

    reserved_stock =
      reserved_stock + _quantity,

    updated_at = now()

  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id;

END;
$$;


GRANT EXECUTE
ON FUNCTION public.reserve_shared_stock(
  uuid,
  uuid,
  numeric
)
TO authenticated, anon;


-- ============================================================
-- 11. LIBERAR RESERVA
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
    RAISE EXCEPTION
      'quantity must be greater than zero';
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

END;
$$;


GRANT EXECUTE
ON FUNCTION public.release_shared_stock(
  uuid,
  uuid,
  numeric
)
TO authenticated, anon;


-- ============================================================
-- 12. CANCELACIÓN DE VENTA
--
-- Devuelve productos al inventario central.
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
     AND NOT public.is_manager()
  THEN
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
-- 13. KPI DE INVENTARIO CENTRAL
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

    'reserved_units',
    COALESCE(
      SUM(reserved_stock),
      0
    ),

    'available_units',
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
      SUM(
        stock * COALESCE(
          cost,
          0
        )
      ),
      0
    ),

    'inventory_retail',
    COALESCE(
      SUM(
        stock * COALESCE(
          price,
          0
        )
      ),
      0
    ),

    'out_of_stock',
    COUNT(*) FILTER (
      WHERE
        GREATEST(
          stock - reserved_stock,
          0
        ) <= 0
    ),

    'low_stock',
    COUNT(*) FILTER (
      WHERE
        min_stock > 0
        AND GREATEST(
          stock - reserved_stock,
          0
        ) <= min_stock
    )

  )

  FROM public.v_shared_inventory;
$$;


GRANT EXECUTE
ON FUNCTION public.get_inventory_kpis()
TO authenticated;


-- ============================================================
-- 14. ALERTAS DE INVENTARIO
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
SET search_path = public
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

      WHEN GREATEST(
        si.stock - si.reserved_stock,
        0
      ) <= 0
      THEN 'out_of_stock'

      WHEN
        si.min_stock > 0
        AND GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
      THEN 'low_stock'

      ELSE 'ok'

    END

  FROM public.shared_inventory si

  JOIN public.products p
    ON p.id = si.product_id

  WHERE p.is_active = true

  ORDER BY

    CASE

      WHEN GREATEST(
        si.stock - si.reserved_stock,
        0
      ) <= 0
      THEN 1

      WHEN
        si.min_stock > 0
        AND GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
      THEN 2

      ELSE 3

    END,

    p.name

  LIMIT GREATEST(
    _limit,
    1
  );
$$;


GRANT EXECUTE
ON FUNCTION public.get_ceo_product_alerts(
  integer
)
TO authenticated;


-- ============================================================
-- 15. TOP PRODUCTOS
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
SET search_path = public
AS $$
  SELECT

    si.product_id,

    MAX(si.name_snapshot),

    SUM(si.quantity),

    SUM(si.total),

    SUM(si.cost_total),

    SUM(
      si.total
      - si.cost_total
    ),

    CASE

      WHEN SUM(si.total) > 0

      THEN ROUND(
        (
          SUM(si.total - si.cost_total)
          / SUM(si.total)
        ) * 100,
        2
      )

      ELSE 0

    END

  FROM public.sale_items si

  INNER JOIN public.sales s
    ON s.id = si.sale_id

  WHERE

    s.status = 'completed'

    AND s.created_at >=
      now()
      - make_interval(
          days => GREATEST(
            _days,
            1
          )
        )

  GROUP BY
    si.product_id

  ORDER BY
    SUM(si.total) DESC

  LIMIT GREATEST(
    _limit,
    1
  );
$$;


GRANT EXECUTE
ON FUNCTION public.get_top_products(
  integer,
  integer
)
TO authenticated;


-- ============================================================
-- 16. AUDITORÍA DEL MOTOR DE INVENTARIO
-- ============================================================

COMMENT ON TABLE public.shared_inventory IS
'LULA OS: fuente única de existencia para todas las tiendas.';

COMMENT ON FUNCTION public.adjust_shared_stock(
  uuid,
  uuid,
  numeric,
  text
) IS
'LULA OS: ajusta la existencia central.';

COMMENT ON FUNCTION public.consume_shared_stock(
  uuid,
  uuid,
  numeric
) IS
'LULA OS: consume existencia central durante una venta.';

COMMENT ON FUNCTION public.return_shared_stock(
  uuid,
  uuid,
  numeric
) IS
'LULA OS: devuelve existencia central.';


-- ============================================================
-- 17. CONFIGURACIÓN
-- ============================================================

INSERT INTO public.system_config (
  key,
  value
)
VALUES (
  'inventory_engine',
  jsonb_build_object(
    'mode', 'shared',
    'authoritative_table', 'shared_inventory',
    'legacy_table', 'inventory',
    'branches_share_stock', true
  )
)

ON CONFLICT (key)

DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();


COMMIT;