BEGIN;

CREATE OR REPLACE FUNCTION public.receive_purchase_partial(
  _purchase_id uuid,
  _items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p public.purchases;
  it jsonb;
  pi public.purchase_items;
  remaining numeric;
  to_receive numeric;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT *
  INTO p
  FROM public.purchases
  WHERE id = _purchase_id
  FOR UPDATE;

  IF p.id IS NULL THEN
    RAISE EXCEPTION 'purchase not found';
  END IF;

  IF p.status = 'cancelled' THEN
    RAISE EXCEPTION 'purchase cancelled';
  END IF;

  FOR it IN
    SELECT *
    FROM jsonb_array_elements(_items)
  LOOP

    SELECT *
    INTO pi
    FROM public.purchase_items
    WHERE id = (it->>'item_id')::uuid
      AND purchase_id = _purchase_id
    FOR UPDATE;

    IF pi.id IS NULL THEN
      RAISE EXCEPTION 'item not found';
    END IF;

    remaining :=
      pi.quantity
      - COALESCE(pi.received_quantity, 0);

    to_receive :=
      LEAST(
        remaining,
        GREATEST(
          COALESCE((it->>'qty')::numeric, 0),
          0
        )
      );

    IF to_receive <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.purchase_items
    SET received_quantity =
      COALESCE(received_quantity, 0) + to_receive
    WHERE id = pi.id;

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

  IF NOT EXISTS (
    SELECT 1
    FROM public.purchase_items
    WHERE purchase_id = _purchase_id
      AND COALESCE(received_quantity, 0) < quantity
  ) THEN

    UPDATE public.purchases
    SET
      status = 'received',
      received_at = now(),
      updated_at = now()
    WHERE id = _purchase_id;

  ELSE

    UPDATE public.purchases
    SET updated_at = now()
    WHERE id = _purchase_id;

  END IF;
END;
$$;

REVOKE ALL
ON FUNCTION public.receive_purchase_partial(uuid, jsonb)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.receive_purchase_partial(uuid, jsonb)
TO authenticated;


CREATE OR REPLACE FUNCTION public.receive_purchase(
  _purchase_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  items jsonb;
BEGIN

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'item_id',
          id,
          'qty',
          quantity - COALESCE(received_quantity, 0)
        )
      ),
      '[]'::jsonb
    )
  INTO items
  FROM public.purchase_items
  WHERE purchase_id = _purchase_id;

  PERFORM public.receive_purchase_partial(
    _purchase_id,
    items
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.receive_purchase(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.receive_purchase(uuid)
TO authenticated;

COMMIT;