BEGIN;

DROP POLICY IF EXISTS products_update_permission
ON public.products;

CREATE POLICY products_update_permission
ON public.products
FOR UPDATE
TO authenticated
USING (
  public.has_permission('productos.edit')
)
WITH CHECK (
  public.has_permission('productos.edit')
);

DROP TRIGGER IF EXISTS trg_enforce_products_update_permissions
ON public.products;

DROP FUNCTION IF EXISTS public.enforce_products_update_permissions();

CREATE OR REPLACE FUNCTION public.update_product_prices(
  _product_id uuid,
  _price numeric,
  _cost numeric,
  _tax_rate numeric
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('productos.price') THEN
    RAISE EXCEPTION 'not authorized: productos.price';
  END IF;

  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'product is required';
  END IF;

  IF _price IS NULL
     OR _price < 0
     OR _cost IS NULL
     OR _cost < 0
     OR _tax_rate IS NULL
     OR _tax_rate < 0
  THEN
    RAISE EXCEPTION 'invalid product price data';
  END IF;

  UPDATE public.products
  SET
    price = ROUND(_price, 2),
    cost = ROUND(_cost, 2),
    tax_rate = _tax_rate,
    updated_at = now()
  WHERE id = _product_id
  RETURNING *
  INTO v_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;

  RETURN v_product;
END;
$$;

REVOKE ALL
ON FUNCTION public.update_product_prices(
  uuid,
  numeric,
  numeric,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.update_product_prices(
  uuid,
  numeric,
  numeric,
  numeric
)
TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_product(
  _product_id uuid
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_permission('productos.delete') THEN
    RAISE EXCEPTION 'not authorized: productos.delete';
  END IF;

  IF _product_id IS NULL THEN
    RAISE EXCEPTION 'product is required';
  END IF;

  UPDATE public.products
  SET
    is_active = false,
    updated_at = now()
  WHERE id = _product_id
  RETURNING *
  INTO v_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;

  RETURN v_product;
END;
$$;

REVOKE ALL
ON FUNCTION public.deactivate_product(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.deactivate_product(uuid)
TO authenticated;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_images_public_read
ON storage.objects;

DROP POLICY IF EXISTS product_images_auth_upload
ON storage.objects;

DROP POLICY IF EXISTS product_images_auth_update
ON storage.objects;

DROP POLICY IF EXISTS product_images_auth_delete
ON storage.objects;

CREATE POLICY product_images_public_read
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'product-images'
);

CREATE POLICY product_images_auth_upload
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] <> ''
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id::text = (storage.foldername(name))[1]
  )
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
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id::text = (storage.foldername(name))[1]
  )
  AND (
    public.has_permission('productos.edit')
    OR public.has_permission('productos.create')
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] <> ''
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id::text = (storage.foldername(name))[1]
  )
  AND (
    public.has_permission('productos.edit')
    OR public.has_permission('productos.create')
  )
);

CREATE POLICY product_images_auth_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id::text = (storage.foldername(name))[1]
  )
  AND (
    public.has_permission('productos.edit')
    OR public.has_permission('productos.delete')
  )
);

COMMIT;