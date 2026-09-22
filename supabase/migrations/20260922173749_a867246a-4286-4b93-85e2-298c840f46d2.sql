-- ============================================================
-- LULA OS — endurecimiento de permisos (sin cambio de propiedad)
-- ============================================================

-- 1) Funciones SECURITY DEFINER: quitar ejecucion a anon/public
REVOKE ALL ON FUNCTION public.adjust_stock(uuid, uuid, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.available_stock(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, uuid, numeric, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.available_stock(uuid, uuid, uuid) TO authenticated, service_role;

-- 2) Vista del reporte diario: solo personal autenticado
REVOKE ALL ON public.v_ceo_daily_sales FROM PUBLIC, anon;
GRANT SELECT ON public.v_ceo_daily_sales TO authenticated, service_role;