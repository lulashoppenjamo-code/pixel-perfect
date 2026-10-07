BEGIN;

-- ============================================================
-- LULA OS
-- IMPORTACIÓN MASIVA DE PRODUCTOS + INVENTARIO CENTRAL
--
-- IMPORTANTE:
-- - NO utiliza public.inventory para el stock.
-- - El stock real vive en public.shared_inventory.
-- - products y categories son globales.
-- - Solo managers/admin/owner pueden ejecutar la importación.
-- - El stock del Excel REPRESENTA LA EXISTENCIA FINAL.
--   No se suma al stock existente.
-- ============================================================


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

  v_product_id uuid;
  v_category_id uuid;

  v_nombre text;
  v_sku text;
  v_barcode text;
  v_categoria text;
  v_descripcion text;

  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_min numeric;
  v_max numeric;

  v_existing_stock numeric;

  v_created integer := 0;
  v_updated integer := 0;
  v_stock_set integer := 0;

  v_errors jsonb := '[]'::jsonb;

  v_error text;

  v_row integer;

BEGIN

  -- ==========================================================
  -- SEGURIDAD
  -- ==========================================================

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _items IS NULL
     OR jsonb_typeof(_items) <> 'array'
  THEN
    RAISE EXCEPTION 'items must be a JSON array';
  END IF;


  -- ==========================================================
  -- PROCESAR CADA PRODUCTO
  -- ==========================================================

  FOR item IN
    SELECT value
    FROM jsonb_array_elements(_items)
  LOOP

    BEGIN

      -- --------------------------------------------------------
      -- LEER DATOS
      -- --------------------------------------------------------

      v_nombre :=
        NULLIF(
          btrim(item->>'nombre'),
          ''
        );

      v_sku :=
        NULLIF(
          btrim(item->>'sku'),
          ''
        );

      v_barcode :=
        NULLIF(
          btrim(item->>'codigo_barras'),
          ''
        );

      v_categoria :=
        NULLIF(
          btrim(item->>'categoria'),
          ''
        );

      v_descripcion :=
        NULLIF(
          btrim(item->>'descripcion'),
          ''
        );

      v_price :=
        COALESCE(
          NULLIF(item->>'precio_venta', '')::numeric,
          0
        );

      v_cost :=
        COALESCE(
          NULLIF(item->>'costo', '')::numeric,
          0
        );

      v_stock :=
        COALESCE(
          NULLIF(item->>'stock', '')::numeric,
          0
        );

      v_min :=
        COALESCE(
          NULLIF(item->>'minimo', '')::numeric,
          0
        );

      v_max :=
        CASE
          WHEN item->>'maximo' IS NULL
            OR btrim(item->>'maximo') = ''
          THEN NULL
          ELSE (item->>'maximo')::numeric
        END;


      -- --------------------------------------------------------
      -- VALIDACIONES
      -- --------------------------------------------------------

      IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'Nombre vacío';
      END IF;

      IF v_price < 0 THEN
        RAISE EXCEPTION 'Precio inválido';
      END IF;

      IF v_cost < 0 THEN
        RAISE EXCEPTION 'Costo inválido';
      END IF;

      IF v_stock < 0 THEN
        RAISE EXCEPTION 'Stock inválido';
      END IF;

      IF v_min < 0 THEN
        RAISE EXCEPTION 'Mínimo inválido';
      END IF;

      IF v_max IS NOT NULL
         AND v_max < v_min
      THEN
        RAISE EXCEPTION
          'Máximo no puede ser menor que mínimo';
      END IF;


      -- --------------------------------------------------------
      -- BUSCAR CATEGORÍA
      --
      -- Las categorías son globales.
      -- Si no existe, se crea.
      -- --------------------------------------------------------

      v_category_id := NULL;

      IF v_categoria IS NOT NULL THEN

        SELECT id
        INTO v_category_id
        FROM public.categories
        WHERE lower(btrim(name)) = lower(v_categoria)
        ORDER BY created_at
        LIMIT 1;

        IF v_category_id IS NULL THEN

          INSERT INTO public.categories (
            name
          )
          VALUES (
            v_categoria
          )
          RETURNING id
          INTO v_category_id;

        END IF;

      END IF;


      -- --------------------------------------------------------
      -- BUSCAR PRODUCTO EXISTENTE
      --
      -- Prioridad:
      -- 1. SKU
      -- 2. Código de barras
      -- --------------------------------------------------------

      v_product_id := NULL;

      IF v_sku IS NOT NULL THEN

        SELECT id
        INTO v_product_id
        FROM public.products
        WHERE lower(btrim(sku)) = lower(v_sku)
        LIMIT 1;

      END IF;


      IF v_product_id IS NULL
         AND v_barcode IS NOT NULL
      THEN

        SELECT id
        INTO v_product_id
        FROM public.products
        WHERE lower(btrim(barcode)) = lower(v_barcode)
        LIMIT 1;

      END IF;


      -- ========================================================
      -- PRODUCTO NUEVO
      -- ========================================================

      IF v_product_id IS NULL THEN

        INSERT INTO public.products (
          sku,
          name,
          description,
          category_id,
          price,
          cost,
          barcode,
          is_active
        )
        VALUES (
          v_sku,
          v_nombre,
          v_descripcion,
          v_category_id,
          v_price,
          v_cost,
          v_barcode,
          true
        )
        RETURNING id
        INTO v_product_id;

        v_created := v_created + 1;


      -- ========================================================
      -- PRODUCTO EXISTENTE
      -- ========================================================

      ELSE

        UPDATE public.products
        SET
          sku =
            CASE
              WHEN v_sku IS NOT NULL
              THEN v_sku
              ELSE sku
            END,

          name = v_nombre,

          description =
            CASE
              WHEN v_descripcion IS NOT NULL
              THEN v_descripcion
              ELSE description
            END,

          category_id =
            COALESCE(
              v_category_id,
              category_id
            ),

          price = v_price,
          cost = v_cost,

          barcode =
            CASE
              WHEN v_barcode IS NOT NULL
              THEN v_barcode
              ELSE barcode
            END,

          updated_at = now()

        WHERE id = v_product_id;

        v_updated := v_updated + 1;

      END IF;


      -- ========================================================
      -- INVENTARIO CENTRAL
      --
      -- El stock importado es la EXISTENCIA FINAL.
      --
      -- Ejemplo:
      -- stock actual = 20
      -- Excel = 35
      --
      -- resultado = 35
      --
      -- NO:
      -- 20 + 35 = 55
      -- ========================================================

      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          v_product_id::text
          || ':NO_VARIANT',
          0
        )
      );


      SELECT stock
      INTO v_existing_stock
      FROM public.shared_inventory
      WHERE product_id = v_product_id
        AND variant_id IS NULL
      FOR UPDATE;


      IF FOUND THEN

        UPDATE public.shared_inventory
        SET
          stock = v_stock,

          min_stock = v_min,

          max_stock = v_max,

          updated_at = now()

        WHERE product_id = v_product_id
          AND variant_id IS NULL;

      ELSE

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
          NULL,
          v_stock,
          0,
          v_min,
          v_max
        );

      END IF;


      v_stock_set := v_stock_set + 1;


      -- --------------------------------------------------------
      -- MOVIMIENTO DE INVENTARIO
      --
      -- La sucursal solamente sirve como contexto histórico.
      -- El stock real continúa siendo shared_inventory.
      -- --------------------------------------------------------

      IF _branch_id IS NOT NULL THEN

        INSERT INTO public.inventory_movements (
          branch_id,
          product_id,
          variant_id,
          type,
          quantity,
          reference_type,
          notes,
          created_by
        )
        VALUES (
          _branch_id,
          v_product_id,
          NULL,

          CASE
            WHEN v_existing_stock IS NULL
              AND v_stock > 0
            THEN 'adjustment_in'::public.movement_type

            WHEN v_existing_stock IS NULL
              AND v_stock = 0
            THEN 'adjustment_in'::public.movement_type

            WHEN v_stock >= COALESCE(v_existing_stock, 0)
            THEN 'adjustment_in'::public.movement_type

            ELSE 'adjustment_out'::public.movement_type
          END,

          ABS(
            v_stock
            - COALESCE(v_existing_stock, 0)
          ),

          'bulk_import',

          'Importación masiva de inventario',

          uid
        );

      END IF;


    EXCEPTION
      WHEN OTHERS THEN

        v_row :=
          COALESCE(
            NULLIF(item->>'row', '')::integer,
            0
          );

        v_error := SQLERRM;

        v_errors :=
          v_errors
          ||
          jsonb_build_array(
            jsonb_build_object(
              'row',
              v_row,

              'nombre',
              COALESCE(
                item->>'nombre',
                '?'
              ),

              'error',
              v_error
            )
          );

    END;

  END LOOP;


  -- ==========================================================
  -- RESULTADO
  -- ==========================================================

  RETURN jsonb_build_object(
    'created',
    v_created,

    'updated',
    v_updated,

    'stock_set',
    v_stock_set,

    'errors',
    v_errors
  );

END;
$$;


-- ============================================================
-- PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.bulk_import_products(
  jsonb,
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.bulk_import_products(
  jsonb,
  uuid
)
TO authenticated;


COMMENT ON FUNCTION public.bulk_import_products(
  jsonb,
  uuid
)
IS
'LULA OS: importación masiva de productos y existencia final en inventario central compartido. Procesa lotes JSON y crea/actualiza categorías, productos y shared_inventory.';


COMMIT;