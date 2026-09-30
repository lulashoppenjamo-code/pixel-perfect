-- ============================================================
-- LULA OS v1.1 — CORRECCIONES DE SEGURIDAD
-- ============================================================
-- 1. productos.edit vs productos.price (columnas reales)
-- 2. Storage product-images más restringido
-- 3. (invite se corrige en Edge Function, no aquí)
--
-- NO modifica inventario compartido.
-- NO modifica create_sale.
-- NO crea tablas/columnas nuevas en products.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Trigger: productos.price solo puede tocar price/cost/tax_rate
--    Columnas reales de public.products (schema + types):
--    sku, name, description, category_id, price, cost, tax_rate,
--    emoji, image_url, has_variants, is_active, barcode, unit,
--    is_weighable, created_at, updated_at
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_products_update_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  can_edit boolean;
  can_price boolean;
BEGIN
  -- Sin sesión no se actualiza
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  can_edit := public.has_permission('productos.edit');
  can_price := public.has_permission('productos.price');

  -- Edición general: permite cualquier columna
  IF can_edit THEN
    RETURN NEW;
  END IF;

  -- Solo precio: únicamente price, cost, tax_rate
  IF can_price THEN
    IF NEW.sku IS DISTINCT FROM OLD.sku
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.category_id IS DISTINCT FROM OLD.category_id
      OR NEW.emoji IS DISTINCT FROM OLD.emoji
      OR NEW.image_url IS DISTINCT FROM OLD.image_url
      OR NEW.has_variants IS DISTINCT FROM OLD.has_variants
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.barcode IS DISTINCT FROM OLD.barcode
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.is_weighable IS DISTINCT FROM OLD.is_weighable
    THEN
      RAISE EXCEPTION
        'not authorized: productos.price only allows price, cost and tax_rate';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'not authorized: productos.edit or productos.price required';
END;
$$;

REVOKE ALL
ON FUNCTION public.enforce_products_update_permissions()
FROM PUBLIC, anon;

-- Trigger BEFORE UPDATE
DROP TRIGGER IF EXISTS trg_enforce_products_update_permissions
ON public.products;

CREATE TRIGGER trg_enforce_products_update_permissions
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_products_update_permissions();

-- RLS UPDATE: se mantiene edit OR price como puerta de entrada;
-- el trigger valida columnas. Asegura que al menos uno exista.
DROP POLICY IF EXISTS products_update_permission ON public.products;

CREATE POLICY products_update_permission
ON public.products
FOR UPDATE
TO authenticated
USING (
  public.has_permission('productos.edit')
  OR public.has_permission('productos.price')
)
WITH CHECK (
  public.has_permission('productos.edit')
  OR public.has_permission('productos.price')
);

-- ------------------------------------------------------------
-- 2) Storage product-images: path por usuario + permisos
--    Formato de objeto: {auth.uid()}/{filename}
-- ------------------------------------------------------------

-- Bucket (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_upload ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_update ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_delete ON storage.objects;

-- Lectura pública (POS/catálogo muestran image_url sin sesión extra)
CREATE POLICY product_images_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-images');

-- Upload: solo autenticados con permiso y path bajo su uid
CREATE POLICY product_images_auth_upload
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
);

-- Update: mismo dueño de carpeta + permiso
CREATE POLICY product_images_auth_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
);

-- Delete: dueño de carpeta + edit o delete
CREATE POLICY product_images_auth_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    public.has_permission('productos.edit')
    OR public.has_permission('productos.delete')
  )
);

COMMIT;
