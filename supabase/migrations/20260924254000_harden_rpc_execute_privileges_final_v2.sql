-- ============================================================
-- LULA OS
-- BLINDAJE FINAL DE RPC + INVENTARIO FÍSICO
-- 2026-09-24
--
-- OBJETIVO:
-- 1. Eliminar EXECUTE público/anónimo de RPC sensibles.
-- 2. Mantener acceso para usuarios autenticados.
-- 3. Corregir firmas reales de PostgreSQL.
-- 4. Proteger RPC financieros.
-- 5. Proteger inventario físico por sucursal.
--
-- NO modifica tablas.
-- NO modifica datos.
-- NO separa shared_inventory.
-- ============================================================

BEGIN;


-- ============================================================
-- FUNCIÓN CENTRAL DE ACCESO A SUCURSAL
-- ============================================================

REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated, service_role;


-- ============================================================
-- INVENTARIO
-- ============================================================

REVOKE ALL
ON FUNCTION public.adjust_stock(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.adjust_stock(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
TO authenticated, service_role;


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


REVOKE ALL
ON FUNCTION public.set_inventory_limits(
  uuid,
  numeric,
  numeric,
  uuid,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_inventory_limits(
  uuid,
  numeric,
  numeric,
  uuid,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- TRANSFERENCIA
-- ============================================================

REVOKE ALL
ON FUNCTION public.transfer_stock(
  uuid,
  text,
  uuid,
  numeric,
  uuid,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.transfer_stock(
  uuid,
  text,
  uuid,
  numeric,
  uuid,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- VENTAS
-- ============================================================

REVOKE ALL
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


REVOKE ALL
ON FUNCTION public.cancel_sale(
  text,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.cancel_sale(
  text,
  uuid
)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.refund_sale(
  jsonb,
  text,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.refund_sale(
  jsonb,
  text,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- CAJA
-- ============================================================

REVOKE ALL
ON FUNCTION public.close_cash_session(
  numeric,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.close_cash_session(
  numeric,
  uuid
)
TO authenticated, service_role;


-- ============================================================
-- CRÉDITOS
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


REVOKE ALL
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
-- INVENTARIO FÍSICO
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
-- COMPRAS
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
-- PEDIDOS ONLINE
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
-- AUTORIZACIÓN
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


COMMIT;