-- ============================================================
-- LULA OS — DEVOLUCIONES
-- MOTOR TRANSACCIONAL SOBRE INVENTARIO CENTRAL
--
-- shared_inventory = fuente única de existencia
--
-- Funciones:
-- 1. Control de cantidad ya devuelta
-- 2. Devolución parcial
-- 3. Devolución total
-- 4. Restauración de stock central
-- 5. Registro de movimiento
-- 6. Protección contra devolución duplicada
-- 7. Actualización automática del estado de la venta
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CANTIDAD DEVUELTA POR PARTIDA
-- ============================================================

ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS returned_quantity numeric
NOT NULL
DEFAULT 0;

-- ============================================================
-- 2. VALIDACIÓN BÁSICA
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sale_items
    WHERE returned_quantity < 0
       OR returned_quantity > quantity
  ) THEN
    RAISE EXCEPTION
      'Existen partidas con returned_quantity inválido';
  END IF;
END;
$$;

-- ============================================================
-- 3. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
sale_items_sale_returned_idx
ON public.sale_items (
  sale_id,
  returned_quantity
);

CREATE INDEX IF NOT EXISTS
sale_items_product_returned_idx
ON public.sale_items (
  product_id,
  variant_id,
  returned_quantity
);

-- ============================================================
-- 4. MOTOR DE DEVOLUCIÓN
--
-- Parámetros:
--
-- _sale_id
-- _items:
-- [
--   {
--     "sale_item_id": "...",
--     "quantity": 1
--   }
-- ]
--
-- _reason
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_sale(
  _sale_id uuid,
  _items jsonb,
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

  v_item jsonb;

  v_sale_item public.sale_items;

  v_requested_qty numeric;

  v_remaining_qty numeric;

  v_total_refund numeric := 0;

  v_all_returned boolean := true;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;

  -- ==========================================================
  -- VALIDACIÓN DEL ARRAY
  -- ==========================================================

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0
  THEN
    RAISE EXCEPTION
      'refund items are required';
  END IF;

  -- ==========================================================
  -- BLOQUEAR LA VENTA
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
  -- SOLO SE PUEDEN DEVOLVER VENTAS ACTIVAS
  -- ==========================================================

  IF v_sale.status NOT IN (
    'completed',
    'partially_refunded'
  ) THEN

    RAISE EXCEPTION
      'sale cannot be refunded in its current status';

  END IF;

  -- ==========================================================
  -- PERMISOS
  --
  -- El cajero que realizó la venta puede devolver.
  -- Manager/admin/owner también.
  -- ==========================================================

  IF v_sale.cashier_id <> uid
     AND NOT public.is_manager()
  THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;

  -- ==========================================================
  -- PROCESAR CADA PARTIDA
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    -- --------------------------------------------------------
    -- ID DE LA PARTIDA
    -- --------------------------------------------------------

    IF NOT (v_item ? 'sale_item_id') THEN
      RAISE EXCEPTION
        'sale_item_id is required';
    END IF;

    -- --------------------------------------------------------
    -- CANTIDAD
    -- --------------------------------------------------------

    v_requested_qty :=
      COALESCE(
        (v_item ->> 'quantity')::numeric,
        0
      );

    IF v_requested_qty <= 0 THEN
      RAISE EXCEPTION
        'refund quantity must be greater than zero';
    END IF;

    -- --------------------------------------------------------
    -- BLOQUEAR PARTIDA
    -- --------------------------------------------------------

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

    -- --------------------------------------------------------
    -- CANTIDAD DISPONIBLE PARA DEVOLVER
    -- --------------------------------------------------------

    v_remaining_qty :=
      v_sale_item.quantity
      - COALESCE(
          v_sale_item.returned_quantity,
          0
        );

    IF v_requested_qty > v_remaining_qty THEN
      RAISE EXCEPTION
        'refund quantity exceeds remaining quantity for sale item';
    END IF;

    -- --------------------------------------------------------
    -- PRODUCTO
    --
    -- Una partida sin producto no puede regresar al inventario.
    -- --------------------------------------------------------

    IF v_sale_item.product_id IS NULL THEN
      RAISE EXCEPTION
        'cannot restore inventory for sale item without product';
    END IF;

    -- ========================================================
    -- ACTUALIZAR CANTIDAD DEVUELTA
    -- ========================================================

    UPDATE public.sale_items
    SET
      returned_quantity =
        COALESCE(returned_quantity, 0)
        + v_requested_qty
    WHERE id = v_sale_item.id;

    -- ========================================================
    -- RESTAURAR INVENTARIO CENTRAL
    -- ========================================================

    PERFORM public.return_shared_stock(
      v_sale_item.product_id,
      v_sale_item.variant_id,
      v_requested_qty
    );

    -- ========================================================
    -- REGISTRAR MOVIMIENTO
    -- ========================================================

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
        _reason,
        'Devolución de venta'
      ),
      uid
    );

    -- ========================================================
    -- CALCULAR IMPORTE DEVUELTO
    -- ========================================================

    v_total_refund :=
      v_total_refund
      +
      (
        CASE
          WHEN v_sale_item.quantity > 0
          THEN
            (
              v_sale_item.total
              / v_sale_item.quantity
            )
            * v_requested_qty
          ELSE 0
        END
      );

  END LOOP;

  -- ==========================================================
  -- VERIFICAR SI TODA LA VENTA YA FUE DEVUELTA
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

  -- ==========================================================
  -- ACTUALIZAR ESTADO
  -- ==========================================================

  UPDATE public.sales
  SET
    status =
      CASE
        WHEN v_all_returned
        THEN 'refunded'::public.sale_status

        ELSE
          'partially_refunded'::public.sale_status
      END,

    notes =
      CASE
        WHEN _reason IS NULL
          OR trim(_reason) = ''
        THEN notes

        WHEN notes IS NULL
          OR trim(notes) = ''
        THEN
          'Devolución: '
          || trim(_reason)

        ELSE
          notes
          || ' | Devolución: '
          || trim(_reason)
      END,

    updated_at = now()

  WHERE id = _sale_id

  RETURNING *
  INTO v_sale;

  -- ==========================================================
  -- DEVOLVER VENTA ACTUALIZADA
  -- ==========================================================

  RETURN v_sale;

END;
$$;

-- ============================================================
-- 5. PERMISO
-- ============================================================

GRANT EXECUTE
ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
TO authenticated;

-- ============================================================
-- 6. DOCUMENTACIÓN
-- ============================================================

COMMENT ON COLUMN public.sale_items.returned_quantity IS
'LULA OS: cantidad de unidades de esta partida que ya fueron devueltas.';

COMMENT ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
) IS
'LULA OS: registra devolución parcial o total y restaura existencia en shared_inventory.';

-- ============================================================
-- 7. ASEGURAR CONSISTENCIA
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_sale_item_returned_quantity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

  IF NEW.returned_quantity < 0 THEN
    RAISE EXCEPTION
      'returned_quantity cannot be negative';
  END IF;

  IF NEW.returned_quantity > NEW.quantity THEN
    RAISE EXCEPTION
      'returned_quantity cannot exceed quantity';
  END IF;

  RETURN NEW;

END;
$$;

DROP TRIGGER IF EXISTS
sale_items_validate_returned_quantity
ON public.sale_items;

CREATE TRIGGER
sale_items_validate_returned_quantity
BEFORE INSERT OR UPDATE
ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION
public.validate_sale_item_returned_quantity();

COMMIT;