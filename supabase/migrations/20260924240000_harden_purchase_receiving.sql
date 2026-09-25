-- ============================================================
-- LULA OS
-- SEGURIDAD FINAL — RECEPCIÓN DE COMPRAS
-- 2026-09-24
--
-- La recepción de compras aumenta shared_inventory.
--
-- OBJETIVOS:
-- 1. Solo usuarios manager/admin/owner.
-- 2. Solo la sucursal autorizada.
-- 3. Compra debe existir.
-- 4. Compra no puede estar cancelada.
-- 5. No recibir más unidades de las compradas.
-- 6. shared_inventory continúa siendo global.
-- 7. Los movimientos conservan la sucursal de origen.
-- 8. SECURITY DEFINER con search_path vacío.
--
-- NO:
-- - crea tablas
-- - elimina tablas
-- - separa inventario
-- - cambia las firmas actuales.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. RECEPCIÓN PARCIAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  p public.purchases;

  it jsonb;

  pi public.purchase_items;

  remaining numeric;

  to_receive numeric;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- PERMISOS
  -- ==========================================================

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- VALIDAR JSON
  -- ==========================================================

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
  THEN
    RAISE EXCEPTION
      'items must be a JSON array';
  END IF;


  -- ==========================================================
  -- BLOQUEAR COMPRA
  -- ==========================================================

  SELECT *
  INTO p
  FROM public.purchases
  WHERE id = _purchase_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'purchase not found';
  END IF;


  -- ==========================================================
  -- SUCURSAL
  -- ==========================================================

  IF p.branch_id IS NULL THEN
    RAISE EXCEPTION
      'purchase branch is required';
  END IF;


  IF NOT public.can_access_branch(p.branch_id) THEN
    RAISE EXCEPTION
      'not allowed for purchase branch %',
      p.branch_id;
  END IF;


  -- ==========================================================
  -- ESTADO
  -- ==========================================================

  IF p.status = 'cancelled' THEN
    RAISE EXCEPTION
      'purchase cancelled';
  END IF;


  -- ==========================================================
  -- PROCESAR ITEMS
  -- ==========================================================

  FOR it IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    IF NOT (it ? 'item_id') THEN
      RAISE EXCEPTION
        'item_id is required';
    END IF;


    -- --------------------------------------------------------
    -- BLOQUEAR ITEM
    -- --------------------------------------------------------

    SELECT *
    INTO pi
    FROM public.purchase_items
    WHERE id =
      (it->>'item_id')::uuid
      AND purchase_id = _purchase_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'purchase item not found';
    END IF;


    -- --------------------------------------------------------
    -- CANTIDAD PENDIENTE
    -- --------------------------------------------------------

    remaining :=
      pi.quantity
      -
      COALESCE(
        pi.received_quantity,
        0
      );


    -- --------------------------------------------------------
    -- CANTIDAD A RECIBIR
    -- --------------------------------------------------------

    to_receive :=
      COALESCE(
        (it->>'qty')::numeric,
        0
      );


    IF to_receive < 0 THEN
      RAISE EXCEPTION
        'received quantity cannot be negative';
    END IF;


    IF to_receive = 0 THEN
      CONTINUE;
    END IF;


    -- --------------------------------------------------------
    -- NO PERMITIR SOBRERECEPCIÓN
    -- --------------------------------------------------------

    IF to_receive > remaining THEN
      RAISE EXCEPTION
        'received quantity exceeds remaining purchase quantity';
    END IF;


    -- ========================================================
    -- ACTUALIZAR ITEM
    -- ========================================================

    UPDATE public.purchase_items
    SET
      received_quantity =
        COALESCE(
          received_quantity,
          0
        )
        + to_receive

    WHERE id = pi.id;


    -- ========================================================
    -- ENTRADA AL INVENTARIO CENTRAL
    -- ========================================================

    INSERT INTO public.shared_inventory (
      product_id,
      variant_id,
      stock
    )
    VALUES (
      pi.product_id,
      pi.variant_id,
      to_receive
    )

    ON CONFLICT (
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
    --
    -- branch_id identifica dónde se recibió.
    -- El stock permanece compartido.
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
  -- ACTUALIZAR ESTADO DE COMPRA
  -- ==========================================================

  IF NOT EXISTS (
    SELECT 1
    FROM public.purchase_items
    WHERE purchase_id = _purchase_id
      AND COALESCE(
        received_quantity,
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


-- ============================================================
-- PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
TO authenticated, service_role;


-- ============================================================
-- 2. RECEPCIÓN TOTAL
--
-- Mantiene exactamente la firma utilizada por el frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase(
  _purchase_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  uid uuid := auth.uid();

  items jsonb;

  v_branch_id uuid;

BEGIN

  -- ==========================================================
  -- AUTENTICACIÓN
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION
      'not authenticated';
  END IF;


  -- ==========================================================
  -- PERMISOS
  -- ==========================================================

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION
      'not allowed';
  END IF;


  -- ==========================================================
  -- VALIDAR COMPRA Y SUCURSAL ANTES DE CONSTRUIR ITEMS
  -- ==========================================================

  SELECT branch_id
  INTO v_branch_id
  FROM public.purchases
  WHERE id = _purchase_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'purchase not found';
  END IF;


  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION
      'purchase branch is required';
  END IF;


  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for purchase branch %',
      v_branch_id;
  END IF;


  -- ==========================================================
  -- CONSTRUIR ITEMS PENDIENTES
  -- ==========================================================

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
            received_quantity,
            0
          )
        )
      ),
      '[]'::jsonb
    )
  INTO items
  FROM public.purchase_items
  WHERE purchase_id = _purchase_id
    AND COALESCE(
      received_quantity,
      0
    ) < quantity;


  -- ==========================================================
  -- DELEGAR AL MOTOR CENTRAL
  -- ==========================================================

  PERFORM public.receive_purchase_partial(
    _purchase_id,
    items
  );

END;
$$;


REVOKE ALL
ON FUNCTION public.receive_purchase(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.receive_purchase(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 3. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
purchase_items_purchase_received_idx
ON public.purchase_items (
  purchase_id,
  received_quantity
);


CREATE INDEX IF NOT EXISTS
purchases_branch_status_idx
ON public.purchases (
  branch_id,
  status
);


-- ============================================================
-- 4. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
IS
'LULA OS: recibe parcial o totalmente una compra y aumenta exclusivamente shared_inventory. Valida acceso a la sucursal.';


COMMENT ON FUNCTION public.receive_purchase(
  uuid
)
IS
'LULA OS: recibe todas las unidades pendientes de una compra mediante receive_purchase_partial.';


COMMIT;