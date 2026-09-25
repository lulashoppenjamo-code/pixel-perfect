-- ============================================================
-- LULA OS
-- SEGURIDAD FINAL — EXECUTE PRIVILEGES
-- 2026-09-24
--
-- OBJETIVO:
-- Evitar que funciones SECURITY DEFINER queden ejecutables
-- accidentalmente por PUBLIC o anon.
--
-- IMPORTANTE:
-- No modifica tablas.
-- No modifica inventario.
-- No modifica datos.
-- No cambia firmas.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. BLOQUEAR FUNCIONES DE AUTORIZACIÓN PARA PUBLIC/ANON
-- ============================================================

REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.has_role(uuid, public.app_role)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_role(uuid, public.app_role)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.is_manager()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_manager()
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.is_admin()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_admin()
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.ensure_profile(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.ensure_profile(text)
TO authenticated, service_role;


-- ============================================================
-- 2. FUNCIONES OPERATIVAS CRÍTICAS
-- ============================================================
--
-- El cliente autenticado necesita estas funciones.
-- anon NO debe poder ejecutarlas.
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  numeric,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.cancel_sale(
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.cancel_sale(
  uuid,
  text
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.refund_sale(
  uuid,
  jsonb,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 3. INVENTARIO
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  text,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  text,
  uuid
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_shared_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 4. COMPRAS
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.receive_purchase_partial(
  uuid,
  jsonb
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.receive_purchase(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.receive_purchase(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 5. CAJA / PAGOS
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.record_sale_payments(
  uuid,
  jsonb
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.record_sale_payments(
  uuid,
  jsonb
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.close_cash_session(
  uuid,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 6. CRÉDITO / ABONOS
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 7. INVENTARIO FÍSICO
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.start_inventory_count()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_inventory_count()
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_inventory_count_item(
  uuid,
  uuid,
  numeric
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.complete_inventory_count(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 8. FUNCIONES DE CONSULTA DE INVENTARIO COMPARTIDO
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.get_shared_inventory()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.get_shared_product_stock(
  uuid,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_shared_product_stock(
  uuid,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 9. CRÉDITO — CONSULTAS
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.get_customer_balance(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_balance(
  uuid
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.get_customer_credit_history(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_history(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 10. ONLINE ORDERS
-- ============================================================
--
-- NO se reemplazan las funciones.
-- Solamente se asegura que anon no pueda ejecutarlas.
--
-- Los cuerpos se mantienen intactos porque son funciones
-- existentes cuyo origen no está completo en el repositorio.
-- ============================================================

REVOKE EXECUTE
ON FUNCTION public.create_online_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  jsonb
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_online_order(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  jsonb
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.fulfill_online_order(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.fulfill_online_order(
  uuid
)
TO authenticated, service_role;


REVOKE EXECUTE
ON FUNCTION public.cancel_online_order(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.cancel_online_order(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 11. DEFAULT PRIVILEGES
-- ============================================================
--
-- Las funciones nuevas no deben quedar automáticamente
-- ejecutables por PUBLIC.
-- ============================================================

ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS
FROM PUBLIC;


ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS
FROM anon;


COMMIT;