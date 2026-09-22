-- ============================================================
-- LULA OS — retira la vista de reporte diario (sin uso, propiedad de superusuario)
-- El panel de direccion y reportes leen directamente de sales.
-- ============================================================
DROP VIEW IF EXISTS public.v_ceo_daily_sales;