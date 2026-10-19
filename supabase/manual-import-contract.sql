-- PENDING REVIEW / NOT APPLIED. Do not execute against production without approval.
-- Prerequisite: the operational public.shared_inventory table must already exist.
-- Do not create it here or migrate legacy inventory automatically.
-- Back up pg_get_functiondef('public.bulk_import_products(jsonb,uuid)'::regprocedure)
-- before applying; restore that definition to roll back this contract.
CREATE OR REPLACE FUNCTION public.bulk_import_products(_items jsonb, _branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  item jsonb; v_id uuid; v_category uuid; old_product public.products;
  old_stock numeric; old_min numeric; old_max numeric; next_stock numeric;
  next_min numeric; next_max numeric; action text; is_new boolean;
  write_data boolean; write_prices boolean; write_stock boolean;
  created integer := 0; updated integer := 0; stock_set integer := 0;
  errors jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'items must be an array'; END IF;
  IF to_regclass('public.shared_inventory') IS NULL THEN RAISE EXCEPTION 'shared_inventory prerequisite missing'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_items) LOOP
    BEGIN
      action := COALESCE(item->>'action', 'update_all');
      IF action NOT IN ('update_all','update_stock','update_price_cost','update_data','skip_existing') THEN RAISE EXCEPTION 'invalid action'; END IF;
      v_id := NULL; old_product := NULL; v_category := NULL;
      IF NULLIF(btrim(item->>'existing_id'),'') IS NOT NULL THEN
        v_id := (item->>'existing_id')::uuid;
        SELECT * INTO old_product FROM public.products WHERE id=v_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'existing product disappeared; analyze file again'; END IF;
      ELSE
        -- Same SKU-first identity as the previous import RPC.
        PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NULLIF(lower(btrim(item->>'sku')),''),NULLIF(lower(btrim(item->>'codigo_barras')),''),item->>'nombre'),0));
        SELECT * INTO old_product FROM public.products
          WHERE NULLIF(btrim(item->>'sku'),'') IS NOT NULL AND lower(btrim(sku))=lower(btrim(item->>'sku')) LIMIT 1 FOR UPDATE;
        IF old_product.id IS NULL THEN
          SELECT * INTO old_product FROM public.products
            WHERE NULLIF(btrim(item->>'codigo_barras'),'') IS NOT NULL AND lower(btrim(barcode))=lower(btrim(item->>'codigo_barras')) LIMIT 1 FOR UPDATE;
        END IF;
        v_id := old_product.id;
      END IF;
      is_new := v_id IS NULL;
      IF NOT is_new AND action='skip_existing' THEN CONTINUE; END IF;
      IF COALESCE(old_product.has_variants,false) OR NULLIF(btrim(item->>'variante'),'') IS NOT NULL THEN RAISE EXCEPTION 'variant import unsupported'; END IF;
      write_data := is_new OR action IN ('update_all','update_data');
      write_prices := is_new OR action IN ('update_all','update_price_cost');
      write_stock := is_new OR action IN ('update_all','update_stock');
      IF is_new AND NULLIF(btrim(item->>'nombre'),'') IS NULL THEN RAISE EXCEPTION 'Nombre vacío'; END IF;
      IF write_prices THEN
        IF NULLIF(item->>'precio_venta','') IS NOT NULL AND ((item->>'precio_venta')::numeric < 0 OR lower(item->>'precio_venta') IN ('nan','infinity','-infinity')) THEN RAISE EXCEPTION 'Precio inválido'; END IF;
        IF NULLIF(item->>'costo','') IS NOT NULL AND ((item->>'costo')::numeric < 0 OR lower(item->>'costo') IN ('nan','infinity','-infinity')) THEN RAISE EXCEPTION 'Costo inválido'; END IF;
      END IF;
      IF write_data AND NULLIF(btrim(item->>'image_url'),'') IS NOT NULL AND item->>'image_url' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'URL de imagen inválida'; END IF;
      IF write_data AND NULLIF(btrim(item->>'categoria'),'') IS NOT NULL THEN
        SELECT id INTO v_category FROM public.categories WHERE lower(btrim(name))=lower(btrim(item->>'categoria')) ORDER BY created_at LIMIT 1;
        IF v_category IS NULL THEN INSERT INTO public.categories(name) VALUES(btrim(item->>'categoria')) RETURNING id INTO v_category; END IF;
      END IF;
      IF is_new THEN
        INSERT INTO public.products(name,sku,barcode,category_id,description,price,cost,unit,image_url,is_active)
        VALUES(btrim(item->>'nombre'),NULLIF(btrim(item->>'sku'),''),NULLIF(btrim(item->>'codigo_barras'),''),v_category,NULLIF(btrim(item->>'descripcion'),''),COALESCE(NULLIF(item->>'precio_venta','')::numeric,0),COALESCE(NULLIF(item->>'costo','')::numeric,0),COALESCE(NULLIF(btrim(item->>'unidad'),''),'pza'),NULLIF(btrim(item->>'image_url'),''),true)
        RETURNING id INTO v_id;
      ELSE
        UPDATE public.products SET
          name=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'nombre'),''),name) ELSE name END,
          sku=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'sku'),''),sku) ELSE sku END,
          barcode=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'codigo_barras'),''),barcode) ELSE barcode END,
          description=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'descripcion'),''),description) ELSE description END,
          category_id=CASE WHEN write_data THEN COALESCE(v_category,category_id) ELSE category_id END,
          unit=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'unidad'),''),unit) ELSE unit END,
          image_url=CASE WHEN write_data THEN COALESCE(NULLIF(btrim(item->>'image_url'),''),image_url) ELSE image_url END,
          price=CASE WHEN write_prices THEN COALESCE(NULLIF(item->>'precio_venta','')::numeric,price) ELSE price END,
          cost=CASE WHEN write_prices THEN COALESCE(NULLIF(item->>'costo','')::numeric,cost) ELSE cost END,
          updated_at=now() WHERE id=v_id;
      END IF;
      IF write_stock AND (is_new OR NULLIF(item->>'stock','') IS NOT NULL OR NULLIF(item->>'minimo','') IS NOT NULL OR NULLIF(item->>'maximo','') IS NOT NULL) THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text || ':NO_VARIANT',0));
        old_stock := NULL; old_min := NULL; old_max := NULL;
        SELECT stock,min_stock,max_stock INTO old_stock,old_min,old_max FROM public.shared_inventory WHERE product_id=v_id AND variant_id IS NULL FOR UPDATE;
        next_stock := COALESCE(NULLIF(item->>'stock','')::numeric,old_stock,0);
        next_min := COALESCE(NULLIF(item->>'minimo','')::numeric,old_min,0);
        next_max := COALESCE(NULLIF(item->>'maximo','')::numeric,old_max);
        IF next_stock < 0 OR next_min < 0 OR next_max < next_min OR next_stock::text IN ('NaN','Infinity','-Infinity') OR next_min::text IN ('NaN','Infinity','-Infinity') OR next_max::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Stock/límites inválidos'; END IF;
        IF old_stock IS NULL THEN
          INSERT INTO public.shared_inventory(product_id,variant_id,stock,reserved_stock,min_stock,max_stock) VALUES(v_id,NULL,next_stock,0,next_min,next_max);
        ELSE
          UPDATE public.shared_inventory SET stock=next_stock,min_stock=next_min,max_stock=next_max,updated_at=now() WHERE product_id=v_id AND variant_id IS NULL;
        END IF;
        IF _branch_id IS NOT NULL AND next_stock <> COALESCE(old_stock,0) THEN
          INSERT INTO public.inventory_movements(branch_id,product_id,variant_id,type,quantity,reference_type,notes,created_by)
          VALUES(_branch_id,v_id,NULL,CASE WHEN next_stock >= COALESCE(old_stock,0) THEN 'adjustment_in'::public.movement_type ELSE 'adjustment_out'::public.movement_type END,abs(next_stock-COALESCE(old_stock,0)),'bulk_import','Importación masiva de inventario',auth.uid());
        END IF;
        stock_set := stock_set+1;
      END IF;
      -- Increment only after the row's entire transaction succeeds.
      IF is_new THEN created:=created+1; ELSE updated:=updated+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      errors := errors || jsonb_build_array(jsonb_build_object('row',item->>'row','nombre',COALESCE(item->>'nombre','?'),'error',SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('import_contract','selective-v1','created',created,'updated',updated,'stock_set',stock_set,'errors',errors);
END;
$$;
-- Existing EXECUTE grants and role checks are retained. No tables or RLS changes.
NOTIFY pgrst, 'reload schema';