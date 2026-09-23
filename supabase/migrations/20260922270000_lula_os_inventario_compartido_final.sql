-- ============================================================
-- LULA OS — PARTE 6
-- INVENTARIO CENTRAL DEFINITIVO + CONTEO FÍSICO
-- + LÍMITES + AJUSTES CON SUCURSAL DE CONTEXTO
--
-- REEMPLAZA LA OPERACIÓN DEL INVENTARIO ANTIGUO.
-- shared_inventory = EXISTENCIA OFICIAL A+B
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ÍNDICE ÚNICO DEL INVENTARIO CENTRAL
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS shared_inventory_product_variant_uidx
ON public.shared_inventory (
  product_id,
  COALESCE(
    variant_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);


-- ============================================================
-- 2. LÍMITES DEL INVENTARIO CENTRAL
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
SET search_path TO public
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
     AND _max_stock < _min_stock THEN
    RAISE EXCEPTION
      'maximum stock cannot be lower than minimum stock';
  END IF;

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
  )
  ON CONFLICT (
    product_id,
    COALESCE(
      variant_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  DO UPDATE SET
    min_stock = EXCLUDED.min_stock,
    max_stock = EXCLUDED.max_stock,
    updated_at = now();

END;
$$;

REVOKE ALL
ON FUNCTION public.set_shared_inventory_limits(uuid,uuid,numeric,numeric)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_shared_inventory_limits(uuid,uuid,numeric,numeric)
TO authenticated;


-- ============================================================
-- 3. AJUSTE CENTRAL CON SUCURSAL DE CONTEXTO
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_shared_stock_with_branch(
  _branch_id uuid,
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

  IF _quantity = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches
    WHERE id = _branch_id
  ) THEN
    RAISE EXCEPTION 'branch not found';
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
  ON CONFLICT (
    product_id,
    COALESCE(
      variant_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  DO UPDATE SET
    stock =
      public.shared_inventory.stock + EXCLUDED.stock,
    updated_at = now();

  IF EXISTS (
    SELECT 1
    FROM public.shared_inventory
    WHERE product_id = _product_id
      AND variant_id IS NOT DISTINCT FROM _variant_id
      AND stock < 0
  ) THEN

    RAISE EXCEPTION
      'insufficient shared physical stock';

  END IF;

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
      ELSE 'adjustment_out'::public.movement_type
    END,

    ABS(_quantity),

    COALESCE(
      _notes,
      'Ajuste de inventario central'
    ),

    uid
  );

END;
$$;

REVOKE ALL
ON FUNCTION public.adjust_shared_stock_with_branch(
  uuid,
  uuid,
  uuid,
  numeric,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.adjust_shared_stock_with_branch(
  uuid,
  uuid,
  uuid,
  numeric,
  text
)
TO authenticated;


-- ============================================================
-- 4. PUENTE adjust_stock()
-- TODAS LAS LLAMADAS EXISTENTES DEL FRONTEND
-- SIGUEN FUNCIONANDO, PERO YA MODIFICAN shared_inventory.
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
SET search_path TO public
AS $$
BEGIN

  PERFORM public.adjust_shared_stock_with_branch(
    _branch_id,
    _product_id,
    _variant_id,
    _quantity,
    _notes
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


-- ============================================================
-- 5. INICIAR CONTEO FÍSICO SOBRE INVENTARIO CENTRAL
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
  RETURNING id
  INTO count_id;

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
    COALESCE(
      pv.cost_override,
      p.cost,
      0
    )
  FROM public.shared_inventory si
  JOIN public.products p
    ON p.id = si.product_id
  LEFT JOIN public.product_variants pv
    ON pv.id = si.variant_id
  WHERE p.is_active = true;

  RETURN count_id;

END;
$$;

REVOKE ALL
ON FUNCTION public.start_inventory_count(uuid,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_inventory_count(uuid,text)
TO authenticated;


-- ============================================================
-- 6. COMPLETAR CONTEO FÍSICO SOBRE SHARED_INVENTORY
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

      UPDATE public.shared_inventory
      SET
        stock = item.counted_stock,
        updated_at = now()
      WHERE product_id = item.product_id
        AND variant_id IS NOT DISTINCT FROM item.variant_id;

      IF NOT FOUND THEN

        INSERT INTO public.shared_inventory (
          product_id,
          variant_id,
          stock,
          min_stock,
          max_stock
        )
        VALUES (
          item.product_id,
          item.variant_id,
          item.counted_stock,
          0,
          NULL
        );

      END IF;

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
          THEN 'adjustment_in'::public.movement_type
          ELSE 'adjustment_out'::public.movement_type
        END,

        ABS(diff),

        _count_id,
        'inventory_count',

        CASE
          WHEN diff > 0
          THEN 'Sobrante de inventario físico central'
          ELSE 'Faltante de inventario físico central'
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
TO authenticated;


-- ============================================================
-- 7. SEGURIDAD: STOCK CENTRAL SOLO POR RPC
-- ============================================================

REVOKE INSERT, UPDATE, DELETE
ON public.shared_inventory
FROM authenticated;

GRANT SELECT
ON public.shared_inventory
TO authenticated;


-- ============================================================
-- 8. STOCK DISPONIBLE
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
  SELECT GREATEST(
    COALESCE(
      (
        SELECT
          stock - reserved_stock
        FROM public.shared_inventory
        WHERE product_id = _product_id
          AND variant_id IS NOT DISTINCT FROM _variant_id
      ),
      0
    ),
    0
  );
$$;

REVOKE ALL
ON FUNCTION public.get_shared_stock(uuid,uuid)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_shared_stock(uuid,uuid)
TO authenticated, anon;


-- ============================================================
-- 9. STOCK PARA POS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_product_stock(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  stock numeric,
  reserved_stock numeric,
  available_stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    si.product_id,
    si.variant_id,
    si.stock,
    si.reserved_stock,
    GREATEST(
      si.stock - si.reserved_stock,
      0
    )
  FROM public.shared_inventory si
  WHERE si.product_id = _product_id
    AND si.variant_id IS NOT DISTINCT FROM _variant_id;
$$;

REVOKE ALL
ON FUNCTION public.get_shared_product_stock(uuid,uuid)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_shared_product_stock(uuid,uuid)
TO authenticated;


-- ============================================================
-- 10. FUNCIÓN PARA CONSULTAR TODO EL INVENTARIO CENTRAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shared_inventory()
RETURNS TABLE (
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
SET search_path TO public
AS $$
  SELECT
    si.id,
    si.product_id,
    si.variant_id,

    p.name,
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
      WHEN
        GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= 0
      THEN 'out_of_stock'

      WHEN
        si.min_stock > 0
        AND
        GREATEST(
          si.stock - si.reserved_stock,
          0
        ) <= si.min_stock
      THEN 'low_stock'

      ELSE 'ok'
    END AS stock_status

  FROM public.shared_inventory si
  JOIN public.products p
    ON p.id = si.product_id

  WHERE p.is_active = true

  ORDER BY p.name;
$$;

REVOKE ALL
ON FUNCTION public.get_shared_inventory()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated;


-- ============================================================
-- 11. ÍNDICES OPERATIVOS
-- ============================================================

CREATE INDEX IF NOT EXISTS shared_inventory_available_idx
ON public.shared_inventory(
  product_id,
  variant_id,
  stock,
  reserved_stock
);

CREATE INDEX IF NOT EXISTS inventory_count_items_product_idx
ON public.inventory_count_items(
  product_id,
  variant_id
);

CREATE INDEX IF NOT EXISTS inventory_movements_branch_date_idx
ON public.inventory_movements(
  branch_id,
  created_at DESC
);


-- ============================================================
-- 12. DOCUMENTACIÓN
-- ============================================================

COMMENT ON TABLE public.shared_inventory IS
'LULA OS: inventario central único A+B. Es la existencia operativa oficial.';

COMMENT ON FUNCTION public.get_shared_inventory() IS
'LULA OS: catálogo completo del inventario central.';

COMMENT ON FUNCTION public.set_shared_inventory_limits(uuid,uuid,numeric,numeric) IS
'LULA OS: configura mínimos y máximos del inventario central.';

COMMENT ON FUNCTION public.complete_inventory_count(uuid) IS
'LULA OS: cierra conteo físico y ajusta exclusivamente shared_inventory.';


COMMIT;