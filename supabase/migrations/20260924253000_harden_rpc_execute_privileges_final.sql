-- ============================================================
-- LULA OS
-- BLINDAJE FINAL DE EXECUTE EN RPC
-- 2026-09-24
--
-- OBJETIVO:
--   - Quitar EXECUTE a PUBLIC y anon en RPC sensibles.
--   - Permitir ejecución a usuarios autenticados.
--   - Mantener service_role donde corresponde.
--   - NO modificar tablas.
--   - NO modificar datos.
--   - NO modificar lógica de negocio.
--   - NO dividir shared_inventory por sucursal.
--
-- IMPORTANTE:
-- Las firmas fueron comprobadas contra las funciones/migraciones
-- actuales del proyecto.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. AJUSTE DE INVENTARIO
-- Firma REAL:
-- (uuid, uuid, numeric, uuid, text)
-- ============================================================

REVOKE ALL
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 2. CONSULTAS DE INVENTARIO
-- ============================================================

REVOKE ALL
ON FUNCTION public.available_stock(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.available_stock(
  uuid,
  uuid,
  uuid
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.get_shared_inventory()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated, service_role;


REVOKE ALL
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
-- 3. LÍMITES DE INVENTARIO COMPARTIDO
-- ============================================================

REVOKE ALL
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
-- 4. COMPATIBILIDAD DE LÍMITES POR SUCURSAL
--
-- Firma:
-- (branch_id, product_id, min_stock, max_stock, variant_id)
-- ============================================================

REVOKE ALL
ON FUNCTION public.set_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_inventory_limits(
  uuid,
  uuid,
  numeric,
  numeric,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 5. CREAR VENTA
--
-- Firma:
-- (branch_id, items, payment_method,
--  cash_received, cash_session_id, customer_id, discount)
-- ============================================================

REVOKE ALL
ON FUNCTION public.create_sale(
  uuid,
  jsonb,
  public.payment_method,
  uuid,
  uuid,
  uuid,
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
  uuid,
  numeric
)
TO authenticated, service_role;


-- ============================================================
-- 6. PAGOS MIXTOS
-- ============================================================

REVOKE ALL
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


-- ============================================================
-- 7. CANCELACIÓN DE VENTA
-- ============================================================

REVOKE ALL
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


-- ============================================================
-- 8. DEVOLUCIONES
-- ============================================================

REVOKE ALL
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
-- 9. CAJA
-- ============================================================

REVOKE ALL
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
-- 10. ABONOS DE CRÉDITO
--
-- Firma REAL:
-- customer_id
-- amount
-- payment_method
-- branch_id
-- cash_session_id
-- notes
-- ============================================================

REVOKE ALL
ON FUNCTION public.register_credit_payment(
  uuid,
  numeric,
  text,
  uuid,
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
  uuid,
  text
)
TO authenticated, service_role;


-- ============================================================
-- 11. HISTORIAL / SALDO DE CRÉDITO
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_customer_balance(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_balance(
  uuid
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_customer_credit_summary(
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- 12. INVENTARIO FÍSICO
-- ============================================================

REVOKE ALL
ON FUNCTION public.start_inventory_count(
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.start_inventory_count(
  uuid,
  text
)
TO authenticated, service_role;


REVOKE ALL
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


REVOKE ALL
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
-- 13. COMPRAS
-- ============================================================

REVOKE ALL
ON FUNCTION public.receive_purchase(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.receive_purchase(
  uuid
)
TO authenticated, service_role;


REVOKE ALL
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


-- ============================================================
-- 14. PEDIDOS ONLINE
-- ============================================================

REVOKE ALL
ON FUNCTION public.create_online_order(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  jsonb,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_online_order(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  numeric,
  jsonb,
  text
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.fulfill_online_order(
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.fulfill_online_order(
  uuid
)
TO authenticated, service_role;


REVOKE ALL
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
-- 15. FUNCIONES DE AUTORIZACIÓN
--
-- Estas deben seguir disponibles para RLS y la aplicación.
-- No se eliminan para authenticated.
-- ============================================================

REVOKE ALL
ON FUNCTION public.has_role(
  public.app_role,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_role(
  public.app_role,
  uuid
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.is_admin()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_admin()
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.is_manager()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_manager()
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.ensure_profile(
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.ensure_profile(
  text
)
TO authenticated, service_role;


-- ============================================================
-- 16. TRANSFERENCIAS DE STOCK
-- Si esta RPC está instalada en la base actual, queda protegida.
-- ============================================================

REVOKE ALL
ON FUNCTION public.transfer_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.transfer_stock(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
TO authenticated, service_role;


COMMIT;