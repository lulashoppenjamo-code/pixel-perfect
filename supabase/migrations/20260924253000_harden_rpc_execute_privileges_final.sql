-- ============================================================
-- LULA OS
-- BLINDAJE FINAL DE EXECUTE EN RPC
-- 2026-09-24
--
-- IMPORTANTE:
-- Las firmas están en el orden real de PostgreSQL según
-- src/integrations/supabase/types.ts.
--
-- NO modifica tablas.
-- NO modifica datos.
-- NO modifica shared_inventory.
-- ============================================================

BEGIN;


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


-- ============================================================
-- LÍMITES DE INVENTARIO LEGACY / COMPATIBILIDAD
--
-- Firma real:
-- _branch_id
-- _max_stock
-- _min_stock
-- _product_id
-- _variant_id
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
TO authenticated, service_role;


-- ============================================================
-- TRANSFERENCIA DE STOCK
--
-- Firma real:
-- _from_branch_id
-- _notes
-- _product_id
-- _quantity
-- _to_branch_id
-- _variant_id
--
-- NOTA:
-- La operación puede existir aunque actualmente Lula OS
-- mantenga shared_inventory como inventario global.
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
--
-- Firma REAL de create_sale:
--
-- _branch_id
-- _cash_received
-- _cash_session_id
-- _customer_id
-- _discount
-- _items
-- _payment_method
-- ============================================================

REVOKE ALL
ON FUNCTION public.create_sale(
  uuid,
  numeric,
  uuid,
  uuid,
  numeric,
  jsonb,
  public.payment_method
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_sale(
  uuid,
  numeric,
  uuid,
  uuid,
  numeric,
  jsonb,
  public.payment_method
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