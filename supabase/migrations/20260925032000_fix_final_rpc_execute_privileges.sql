-- ============================================================
-- LULA OS
-- CORRECCIÓN FINAL DE EXECUTE PRIVILEGES
-- 2026-09-25
--
-- Corrige únicamente las firmas de funciones RPC.
--
-- IMPORTANTE:
-- Las funciones ya existen y fueron implementadas en
-- migraciones anteriores.
--
-- NO:
-- - modifica tablas
-- - modifica inventario
-- - modifica ventas
-- - modifica caja
-- - modifica crédito
-- - modifica devoluciones
-- - cambia firmas de funciones
--
-- Solamente corrige los permisos EXECUTE para que coincidan
-- con las firmas reales utilizadas por PostgreSQL y Supabase.
-- ============================================================

BEGIN;


-- ============================================================
-- CANCELAR VENTA
--
-- FIRMA REAL:
-- cancel_sale(uuid, text)
--
-- El orden correcto es:
--   _sale_id
--   _reason
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
TO authenticated;


-- ============================================================
-- DEVOLUCIÓN
--
-- FIRMA REAL:
-- refund_sale(uuid, jsonb, text)
--
-- El orden correcto es:
--   _sale_id
--   _items
--   _reason
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
TO authenticated;


-- ============================================================
-- CERRAR CAJA
--
-- FIRMA REAL:
-- close_cash_session(uuid, numeric)
--
-- El orden correcto es:
--   _session_id
--   _closing_amount
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
TO authenticated;


-- ============================================================
-- PAGOS MIXTOS
--
-- FIRMA REAL:
-- record_sale_payments(uuid, jsonb)
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
TO authenticated;


-- ============================================================
-- CREAR VENTA
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
TO authenticated;


-- ============================================================
-- ABONO DE CRÉDITO
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
TO authenticated;


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
TO authenticated;


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
TO authenticated;


REVOKE ALL
ON FUNCTION public.complete_inventory_count(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.complete_inventory_count(
  uuid
)
TO authenticated;


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
TO authenticated;


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
TO authenticated;


-- ============================================================
-- PEDIDOS ONLINE
-- ============================================================

REVOKE ALL
ON FUNCTION public.fulfill_online_order(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.fulfill_online_order(
  uuid
)
TO authenticated;


REVOKE ALL
ON FUNCTION public.cancel_online_order(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.cancel_online_order(
  uuid
)
TO authenticated;


-- ============================================================
-- FUNCIONES DE AUTORIZACIÓN
-- ============================================================

REVOKE ALL
ON FUNCTION public.can_access_branch(
  uuid
)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.can_access_branch(
  uuid
)
TO authenticated, service_role;


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
-- INVENTARIO COMPARTIDO
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_shared_inventory()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_shared_inventory()
TO authenticated;


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
TO authenticated;


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
TO authenticated;


-- ============================================================
-- AJUSTE DE INVENTARIO
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
TO authenticated;


-- ============================================================
-- LÍMITES DE INVENTARIO
-- ============================================================

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
TO authenticated;


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
TO authenticated;


-- ============================================================
-- STOCK DISPONIBLE
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
TO authenticated;


COMMIT;