-- ============================================================
-- LULA OS — Importación masiva RÁPIDA
-- bulk_import_products(jsonb, uuid)
-- Procesa un lote (recomendado 500) en UNA sola llamada SQL:
-- categorías, productos (nombre, barcode, sku, precio, costo),
-- y stock ABSOLUTO en shared_inventory.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_import_products(
  _items jsonb,
  _branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  item jsonb;
  v_name text;
  v_sku text;
  v_barcode text;
  v_categoria text;
  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_min numeric;
  v_max numeric;
  v_desc text;
  v_category_id uuid;
  v_product_id uuid;
  v_created int := 0;
  v_updated int := 0;
  v_stock_set int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a json array';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    BEGIN
      v_name := NULLIF(trim(COALESCE(item->>'nombre', item->>'name', '')), '');
      v_sku := NULLIF(trim(COALESCE(item->>'sku', '')), '');
      v_barcode := NULLIF(trim(COALESCE(item->>'codigo_barras', item->>'barcode', '')), '');
      v_categoria := NULLIF(trim(COALESCE(item->>'categoria', item->>'category', '')), '');
      v_price := COALESCE(NULLIF(item->>'precio_venta', '')::numeric, NULLIF(item->>'price', '')::numeric, 0);
      v_cost := COALESCE(NULLIF(item->>'costo', '')::numeric, NULLIF(item->>'cost', '')::numeric, 0);
      v_stock := COALESCE(NULLIF(item->>'stock', '')::numeric, 0);
      v_min := COALESCE(NULLIF(item->>'minimo', '')::numeric, 0);
      BEGIN
        v_max := NULLIF(item->>'maximo', '')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_max := NULL;
      END;
      v_desc := NULLIF(trim(COALESCE(item->>'descripcion', '')), '');

      IF v_name IS NULL THEN
        RAISE EXCEPTION 'nombre vacío';
      END IF;

      IF v_price < 0 OR v_cost < 0 OR v_stock < 0 THEN
        RAISE EXCEPTION 'precio/costo/stock inválido';
      END IF;

      -- Categoría
      v_category_id := NULL;
      IF v_categoria IS NOT NULL THEN
        SELECT id INTO v_category_id
        FROM public.categories
        WHERE lower(name) = lower(v_categoria)
        LIMIT 1;

        IF v_category_id IS NULL THEN
          INSERT INTO public.categories (name)
          VALUES (v_categoria)
          RETURNING id INTO v_category_id;
        END IF;
      END IF;

      -- Producto existente: barcode → sku → nombre
      v_product_id := NULL;

      IF v_barcode IS NOT NULL THEN
        SELECT id INTO v_product_id
        FROM public.products
        WHERE barcode = v_barcode
        LIMIT 1;
      END IF;

      IF v_product_id IS NULL AND v_sku IS NOT NULL THEN
        SELECT id INTO v_product_id
        FROM public.products
        WHERE sku = v_sku
        LIMIT 1;
      END IF;

      IF v_product_id IS NULL THEN
        SELECT id INTO v_product_id
        FROM public.products
        WHERE lower(name) = lower(v_name)
          AND is_active = true
        LIMIT 1;
      END IF;

      IF v_product_id IS NULL THEN
        INSERT INTO public.products (
          name, sku, barcode, category_id,
          price, cost, description,
          is_active, has_variants, tax_rate, unit, emoji
        ) VALUES (
          v_name, v_sku, v_barcode, v_category_id,
          v_price, v_cost, v_desc,
          true, false, 0, 'pza', '📦'
        )
        RETURNING id INTO v_product_id;
        v_created := v_created + 1;
      ELSE
        UPDATE public.products SET
          name = v_name,
          sku = COALESCE(v_sku, sku),
          barcode = COALESCE(v_barcode, barcode),
          category_id = COALESCE(v_category_id, category_id),
          price = v_price,
          cost = v_cost,
          description = COALESCE(v_desc, description),
          is_active = true,
          updated_at = now()
        WHERE id = v_product_id;
        v_updated := v_updated + 1;
      END IF;

      -- Stock ABSOLUTO en shared_inventory (producto sin variante)
      UPDATE public.shared_inventory
      SET
        stock = v_stock,
        min_stock = COALESCE(v_min, 0),
        max_stock = COALESCE(v_max, max_stock),
        updated_at = now()
      WHERE product_id = v_product_id
        AND variant_id IS NULL;

      IF NOT FOUND THEN
        INSERT INTO public.shared_inventory (
          product_id, variant_id, stock, min_stock, max_stock
        ) VALUES (
          v_product_id, NULL, v_stock, COALESCE(v_min, 0), v_max
        );
      END IF;

      v_stock_set := v_stock_set + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'nombre', COALESCE(v_name, '?'),
          'error', SQLERRM
        )
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'stock_set', v_stock_set,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_products(jsonb, uuid)
TO authenticated;

COMMIT;
