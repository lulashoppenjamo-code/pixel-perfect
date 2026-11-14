
CREATE OR REPLACE FUNCTION public.clear_product_catalog(_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede vaciar el inventario.';
  END IF;

  IF _confirmation IS DISTINCT FROM 'BORRAR INVENTARIO' THEN
    RAISE EXCEPTION 'Confirmación incorrecta.';
  END IF;

  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*)::integer
  INTO v_products
  FROM public.products;

  DELETE FROM public.purchase_items pi
  WHERE EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = pi.product_id
  );

  DELETE FROM public.inventory_count_items ci
  WHERE EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = ci.product_id
  );

  DELETE FROM public.products;

  RETURN jsonb_build_object(
    'deleted_products',
    v_products
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.clear_product_catalog(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.clear_product_catalog(text)
TO authenticated;
