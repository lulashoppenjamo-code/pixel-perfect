-- ============================================================
-- LULA OS v1.1 PASO 4 — Storage para imágenes de producto
-- Usa products.image_url existente. NO crea columnas nuevas.
-- ============================================================

BEGIN;

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

CREATE POLICY product_images_public_read
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-images');

CREATE POLICY product_images_auth_upload
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
);

CREATE POLICY product_images_auth_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (
    public.has_permission('productos.create')
    OR public.has_permission('productos.edit')
  )
);

CREATE POLICY product_images_auth_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.has_permission('productos.edit')
    OR public.has_permission('productos.delete')
  )
);

COMMIT;
