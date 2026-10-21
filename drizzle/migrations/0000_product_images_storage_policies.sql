DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_read ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_upload ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_update ON storage.objects;
DROP POLICY IF EXISTS product_images_auth_delete ON storage.objects;

CREATE POLICY product_images_auth_read
ON storage.objects
FOR SELECT
TO authenticated
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