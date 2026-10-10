BEGIN;

-- ============================================================
-- LULA OS
-- FIX MOTOR INVENTARIO COMPARTIDO
-- Parte 6
--
-- shared_inventory = fuente única de stock operativo
--
-- Corrige:
-- 1. consume_shared_stock()
-- 2. adjust_shared_stock()
-- 3. set_shared_inventory_limits()
-- 4. available_stock()
-- 5. evita stock negativo
-- 6. mantiene compatibilidad con POS existente
-- ============================================================


-- ============================================================
-- 1. CONSUMIR STOCK COMPARTIDO
--
-- Se utiliza en create_sale().
-- Descuenta directamente de shared_inventory.
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
  current_stock numeric;
  current_reserved numeric;
  available numeric;
BEGIN

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;

  SELECT
    stock,
    reserved_stock
  INTO
    current_stock,
    current_reserved
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe inventario compartido para el producto';
  END IF;

  available :=
    GREATEST(
      current_stock - current_reserved,
      0
    );

  IF available < _quantity THEN
    RAISE EXCEPTION
      'Stock compartido insuficiente. Disponible: %, solicitado: %',
      available,
      _quantity;
  END IF;

  UPDATE public.shared_inventory
  SET
    stock = stock - _quantity,

    reserved_stock =
      GREATEST(
        reserved_stock -
          LEAST(
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
-- 2. AJUSTE DE STOCK COMPARTIDO
--
-- Entrada:
--   cantidad positiva
--
-- Salida:
--   cantidad negativa
--
-- Nunca permite que el stock quede negativo.
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
  current_stock numeric;
  new_stock numeric;
  movement_type public.movement_type;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'Sin permisos para ajustar inventario';
  END IF;

  IF _quantity IS NULL OR _quantity = 0 THEN
    RETURN;
  END IF;


  SELECT stock
  INTO current_stock
  FROM public.shared_inventory
  WHERE product_id = _product_id
    AND variant_id IS NOT DISTINCT FROM _variant_id
  FOR UPDATE;


  IF NOT FOUND THEN

    IF _quantity < 0 THEN
      RAISE EXCEPTION
        'No existe inventario para realizar una salida';
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
    );

    new_stock := _quantity;

  ELSE

    new_stock :=
      current_stock + _quantity;

    IF new_stock < 0 THEN
      RAISE EXCEPTION
        'El ajuste dejaría el inventario en negativo';
    END IF;

    UPDATE public.shared_inventory
    SET
      stock = new_stock,
      updated_at = now()
    WHERE product_id = _product_id
      AND variant_id IS NOT DISTINCT FROM _variant_id;

  END IF;


  movement_type :=
    CASE
      WHEN _quantity > 0
        THEN 'adjustment_in'::public.movement_type
      ELSE
        'adjustment_out'::public.movement_type
    END;


  /*
   * inventory_movements conserva branch_id porque
   * esa tabla pertenece al modelo histórico.
   *
   * El stock real NO se duplica por sucursal.
   *
   * Se utiliza la primera sucursal solamente como
   * contexto histórico del movimiento central.
   */

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
    movement_type,
    ABS(_quantity),
    COALESCE(
      _notes,
      CASE
        WHEN _quantity > 0
          THEN 'Entrada de inventario'
        ELSE
          'Salida de inventario'
      END
    ),
    uid
  FROM public.branches b
  ORDER BY b.created_at
  LIMIT 1;

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
-- 3. LÍMITES DE INVENTARIO
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

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'Sin permisos para modificar límites de inventario';
  END IF;


  IF _min_stock IS NULL THEN
    RAISE EXCEPTION
      'El mínimo es obligatorio';
  END IF;


  IF _min_stock < 0 THEN
    RAISE EXCEPTION
      'El mínimo no puede ser negativo';
  END IF;


  IF _max_stock IS NOT NULL
     AND _max_stock < _min_stock THEN
    RAISE EXCEPTION
      'El máximo no puede ser menor al mínimo';
  END IF;


  INSERT INTO public.shared_inventory (
    product_id,
    variant_id,
    stock,
    reserved_stock,
    min_stock,
    max_stock
  )
  VALUES (
    _product_id,
    _variant_id,
    0,
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
    min_stock =
      EXCLUDED.min_stock,

    max_stock =
      EXCLUDED.max_stock,

    updated_at =
      now();

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
-- 4. STOCK DISPONIBLE
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
SET search_path TO public
AS $$
  SELECT
    COALESCE(
      (
        SELECT
          GREATEST(
            stock - reserved_stock,
            0
          )
        FROM public.shared_inventory
        WHERE product_id = _product_id
          AND variant_id
            IS NOT DISTINCT FROM _variant_id
        LIMIT 1
      ),
      0
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
-- 5. STOCK CENTRAL DE PRODUCTO
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
    COALESCE(
      (
        SELECT
          GREATEST(
            stock - reserved_stock,
            0
          )
        FROM public.shared_inventory
        WHERE product_id = _product_id
          AND variant_id
            IS NOT DISTINCT FROM _variant_id
        LIMIT 1
      ),
      0
    );
$$;


GRANT EXECUTE
ON FUNCTION public.get_shared_stock(
  uuid,
  uuid
)
TO authenticated, anon;


-- ============================================================
-- 6. RESERVA DE STOCK
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
  current_stock numeric;
  current_reserved numeric;
  available numeric;
BEGIN

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION
      'La cantidad debe ser mayor que cero';
  END IF;


  SELECT
    stock,
    reserved_stock
  INTO
    current_stock,
    current_reserved

  FROM public.shared_inventory

  WHERE product_id = _product_id
    AND variant_id
      IS NOT DISTINCT FROM _variant_id

  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe inventario compartido';
  END IF;


  available :=
    GREATEST(
      current_stock -
        current_reserved,
      0
    );


  IF available < _quantity THEN
    RAISE EXCEPTION
      'Stock insuficiente para reservar';
  END IF;


  UPDATE public.shared_inventory

  SET
    reserved_stock =
      reserved_stock + _quantity,

    updated_at =
      now()

  WHERE product_id = _product_id
    AND variant_id
      IS NOT DISTINCT FROM _variant_id;

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

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RETURN;
  END IF;


  UPDATE public.shared_inventory

  SET
    reserved_stock =
      GREATEST(
        reserved_stock - _quantity,
        0
      ),

    updated_at =
      now()

  WHERE product_id = _product_id
    AND variant_id
      IS NOT DISTINCT FROM _variant_id;

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
-- 8. ASEGURAR ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
shared_inventory_product_variant_lookup_idx

ON public.shared_inventory(
  product_id,
  variant_id
);


CREATE INDEX IF NOT EXISTS
shared_inventory_stock_status_idx

ON public.shared_inventory(
  stock,
  reserved_stock,
  min_stock
);


-- ============================================================
-- 9. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION
public.consume_shared_stock(
  uuid,
  uuid,
  numeric
)
IS
'LULA OS: descuenta existencia del inventario central al completar una venta.';


COMMENT ON FUNCTION
public.adjust_shared_stock(
  uuid,
  uuid,
  numeric,
  text
)
IS
'LULA OS: modifica existencia central sin duplicarla por sucursal.';


COMMENT ON FUNCTION
public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
IS
'LULA OS: configura mínimos y máximos del inventario central.';


COMMIT;