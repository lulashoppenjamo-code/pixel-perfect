BEGIN;

-- ============================================================
-- LULA OS
-- DEVOLUCIONES + INVENTARIO CENTRAL COMPARTIDO
--
-- Objetivos:
--
-- 1. Registrar devoluciones parciales.
-- 2. Evitar devolver más unidades de las vendidas.
-- 3. Evitar devolver dos veces la misma unidad.
-- 4. Restaurar existencia en shared_inventory.
-- 5. Registrar el movimiento histórico.
-- 6. Cambiar automáticamente el estado de la venta:
--      completed
--      partially_refunded
--      refunded
--
-- IMPORTANTE:
-- shared_inventory es la fuente operativa de existencia.
-- inventory queda únicamente como compatibilidad/histórico.
-- ============================================================


-- ============================================================
-- 1. CANTIDAD YA DEVUELTA POR PARTIDA
--
-- Esto permite controlar devoluciones parciales y evita que
-- una misma partida pueda devolverse infinitamente.
-- ============================================================

ALTER TABLE public.sale_items
ADD COLUMN IF NOT EXISTS returned_quantity numeric
NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sale_items.returned_quantity IS
'LULA OS: cantidad acumulada devuelta de esta partida de venta.';


-- ============================================================
-- 2. ÍNDICE
-- ============================================================

CREATE INDEX IF NOT EXISTS
sale_items_sale_returned_idx
ON public.sale_items (
  sale_id,
  returned_quantity
);


-- ============================================================
-- 3. VALIDACIÓN DE DATOS
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
      'Existen sale_items con returned_quantity inválido.';

  END IF;

END;
$$;


-- ============================================================
-- 4. RPC refund_sale()
--
-- Firma compatible con el frontend existente:
--
-- refund_sale(
--   _sale_id uuid,
--   _items jsonb,
--   _reason text
-- )
--
-- _items:
--
-- [
--   {
--     "sale_item_id": "...",
--     "quantity": 1
--   }
-- ]
--
-- La operación se ejecuta dentro de una única transacción.
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_sale(
  _sale_id uuid,
  _items jsonb,
  _reason text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE

  v_sale public.sales%ROWTYPE;

  v_item jsonb;

  v_sale_item public.sale_items%ROWTYPE;

  v_product_id uuid;

  v_variant_id uuid;

  v_quantity numeric;

  v_available_to_refund numeric;

  v_new_returned_quantity numeric;

  v_total_items integer := 0;

  v_total_returned_items integer := 0;

  v_branch_id uuid;

  v_user_id uuid;

  v_reason text;

BEGIN

  -- ----------------------------------------------------------
  -- Usuario actual
  -- ----------------------------------------------------------

  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'Debes iniciar sesión para registrar una devolución.';
  END IF;


  -- ----------------------------------------------------------
  -- Validar venta
  -- ----------------------------------------------------------

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta no existe.';
  END IF;


  v_branch_id := v_sale.branch_id;


  -- ----------------------------------------------------------
  -- Validar estado
  -- ----------------------------------------------------------

  IF v_sale.status NOT IN (
    'completed',
    'partially_refunded'
  ) THEN

    RAISE EXCEPTION
      'La venta no puede recibir otra devolución. Estado actual: %',
      v_sale.status;

  END IF;


  -- ----------------------------------------------------------
  -- Validar JSON
  -- ----------------------------------------------------------

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 THEN

    RAISE EXCEPTION
      'Debes indicar al menos un producto para devolver.';

  END IF;


  v_reason :=
    NULLIF(
      BTRIM(
        COALESCE(
          _reason,
          ''
        )
      ),
      ''
    );


  -- ==========================================================
  -- PROCESAR CADA PARTIDA
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(
      _items
    )
  LOOP

    -- --------------------------------------------------------
    -- Validar IDs
    -- --------------------------------------------------------

    IF v_item->>'sale_item_id' IS NULL THEN
      RAISE EXCEPTION
        'Una partida de devolución no contiene sale_item_id.';
    END IF;


    -- --------------------------------------------------------
    -- Cantidad
    -- --------------------------------------------------------

    v_quantity :=
      COALESCE(
        (v_item->>'quantity')::numeric,
        0
      );


    IF v_quantity <= 0 THEN
      RAISE EXCEPTION
        'La cantidad a devolver debe ser mayor que cero.';
    END IF;


    -- --------------------------------------------------------
    -- Obtener partida bloqueada
    -- --------------------------------------------------------

    SELECT *
    INTO v_sale_item
    FROM public.sale_items
    WHERE id =
      (v_item->>'sale_item_id')::uuid
      AND sale_id = _sale_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'La partida % no pertenece a la venta.',
        v_item->>'sale_item_id';
    END IF;


    -- --------------------------------------------------------
    -- Validar producto
    -- --------------------------------------------------------

    IF v_sale_item.product_id IS NULL THEN
      RAISE EXCEPTION
        'La partida "%" no tiene producto asociado y no puede regresar al inventario.',
        v_sale_item.name_snapshot;
    END IF;


    v_product_id :=
      v_sale_item.product_id;

    v_variant_id :=
      v_sale_item.variant_id;


    -- --------------------------------------------------------
    -- Calcular cantidad todavía disponible para devolver
    -- --------------------------------------------------------

    v_available_to_refund :=
      GREATEST(
        v_sale_item.quantity
        -
        COALESCE(
          v_sale_item.returned_quantity,
          0
        ),
        0
      );


    IF v_quantity >
       v_available_to_refund THEN

      RAISE EXCEPTION
        'No puedes devolver % unidades de "%". Solo quedan % unidades disponibles para devolución.',
        v_quantity,
        v_sale_item.name_snapshot,
        v_available_to_refund;

    END IF;


    -- --------------------------------------------------------
    -- Nueva cantidad devuelta
    -- --------------------------------------------------------

    v_new_returned_quantity :=
      COALESCE(
        v_sale_item.returned_quantity,
        0
      )
      +
      v_quantity;


    UPDATE public.sale_items
    SET returned_quantity =
      v_new_returned_quantity
    WHERE id =
      v_sale_item.id;


    -- ========================================================
    -- RESTAURAR STOCK CENTRAL
    -- ========================================================

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock,
      reserved_stock,
      min_stock,
      max_stock
    )
    VALUES (
      v_product_id,
      v_variant_id,
      v_quantity,
      0,
      0,
      0
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
        public.shared_inventory.stock
        +
        EXCLUDED.stock,
      updated_at =
        now();


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
      v_branch_id,
      v_product_id,
      v_variant_id,
      'return',
      v_quantity,
      _sale_id,
      'sale_refund',
      COALESCE(
        v_reason,
        'Devolución de venta'
      ),
      v_user_id
    );


    v_total_items :=
      v_total_items + 1;

  END LOOP;


  -- ==========================================================
  -- DETERMINAR NUEVO ESTADO DE LA VENTA
  -- ==========================================================

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE
        COALESCE(
          returned_quantity,
          0
        ) >= quantity
    )
  INTO
    v_total_items,
    v_total_returned_items
  FROM public.sale_items
  WHERE sale_id = _sale_id;


  IF v_total_items > 0
     AND v_total_returned_items =
         v_total_items THEN

    UPDATE public.sales
    SET
      status = 'refunded',
      notes =
        CASE
          WHEN v_reason IS NULL THEN
            notes
          WHEN notes IS NULL
               OR BTRIM(notes) = '' THEN
            'Devolución: ' || v_reason
          ELSE
            notes ||
            E'\nDevolución: ' ||
            v_reason
        END,
      updated_at = now()
    WHERE id = _sale_id;


  ELSE

    UPDATE public.sales
    SET
      status = 'partially_refunded',
      notes =
        CASE
          WHEN v_reason IS NULL THEN
            notes
          WHEN notes IS NULL
               OR BTRIM(notes) = '' THEN
            'Devolución parcial: ' ||
            v_reason
          ELSE
            notes ||
            E'\nDevolución parcial: ' ||
            v_reason
        END,
      updated_at = now()
    WHERE id = _sale_id;

  END IF;


  -- ==========================================================
  -- DEVOLVER LA VENTA ACTUALIZADA
  -- ==========================================================

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = _sale_id;


  RETURN v_sale;

END;
$$;


-- ============================================================
-- 5. PERMISOS
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

COMMENT ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
IS
'LULA OS: registra devoluciones parciales o totales, controla returned_quantity, restaura shared_inventory y actualiza el estado de la venta.';


-- ============================================================
-- 7. VALIDACIÓN FINAL
-- ============================================================

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_items'
      AND column_name = 'returned_quantity'
  ) THEN

    RAISE EXCEPTION
      'La columna sale_items.returned_quantity no fue creada.';

  END IF;

END;
$$;


COMMIT;