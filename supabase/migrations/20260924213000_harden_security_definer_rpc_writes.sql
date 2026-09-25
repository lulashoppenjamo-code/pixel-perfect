-- ============================================================
-- LULA OS — BLINDAJE FINAL DE RPC SECURITY DEFINER
-- 2026-09-24
--
-- OBJETIVO:
-- Evitar que una función SECURITY DEFINER pueda modificar
-- información de otra sucursal aunque la función omita
-- accidentalmente una validación de branch.
--
-- INVENTARIO:
-- Sigue siendo GLOBAL / COMPARTIDO.
--
-- NO modifica:
--   - tablas
--   - datos
--   - firmas de RPC existentes
--   - lógica del POS
--   - lógica de compras
--   - lógica de pedidos
--
-- Añade defensa adicional a nivel PostgreSQL.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. FUNCIÓN CENTRAL DE VALIDACIÓN DE ESCRITURA
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_branch_write_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch_id uuid;
BEGIN

  -- ----------------------------------------------------------
  -- Service role:
  -- Las operaciones administrativas del backend pueden pasar.
  -- ----------------------------------------------------------

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- ----------------------------------------------------------
  -- Usuario autenticado obligatorio
  -- ----------------------------------------------------------

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ----------------------------------------------------------
  -- Obtener branch_id del registro.
  --
  -- Esta función solamente se instala en tablas que poseen
  -- branch_id.
  -- ----------------------------------------------------------

  v_branch_id := NEW.branch_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION
      'branch_id is required for %',
      TG_TABLE_NAME;
  END IF;

  -- ----------------------------------------------------------
  -- Validar que el usuario pueda trabajar en esa sucursal.
  -- ----------------------------------------------------------

  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      v_branch_id;
  END IF;

  RETURN NEW;

END;
$$;


REVOKE ALL
ON FUNCTION public.enforce_branch_write_access()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.enforce_branch_write_access()
TO authenticated, service_role;


-- ============================================================
-- 2. FUNCIÓN PARA TABLAS SIN branch_id
--    PERO RELACIONADAS CON UNA VENTA
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_sale_parent_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch_id uuid;
BEGIN

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT s.branch_id
  INTO v_branch_id
  FROM public.sales s
  WHERE s.id = NEW.sale_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'sale not found';
  END IF;

  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for sale branch %',
      v_branch_id;
  END IF;

  RETURN NEW;

END;
$$;


REVOKE ALL
ON FUNCTION public.enforce_sale_parent_access()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.enforce_sale_parent_access()
TO authenticated, service_role;


-- ============================================================
-- 3. FUNCIÓN PARA MOVIMIENTOS DE CAJA
--    Relación:
--
-- cash_movements
--      ↓
-- cash_sessions
--      ↓
-- branch_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_cash_parent_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch_id uuid;
BEGIN

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT cs.branch_id
  INTO v_branch_id
  FROM public.cash_sessions cs
  WHERE cs.id = NEW.cash_session_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'cash session not found';
  END IF;

  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for cash session branch %',
      v_branch_id;
  END IF;

  RETURN NEW;

END;
$$;


REVOKE ALL
ON FUNCTION public.enforce_cash_parent_access()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.enforce_cash_parent_access()
TO authenticated, service_role;


-- ============================================================
-- 4. FUNCIÓN PARA ITEMS DE COMPRA
--    Relación:
--
-- purchase_items
--      ↓
-- purchases
--      ↓
-- branch_id
--
-- Esta protección es especialmente importante porque
-- receive_purchase() es SECURITY DEFINER.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_purchase_parent_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch_id uuid;
BEGIN

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT p.branch_id
  INTO v_branch_id
  FROM public.purchases p
  WHERE p.id = NEW.purchase_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'purchase not found';
  END IF;

  IF NOT public.can_access_branch(v_branch_id) THEN
    RAISE EXCEPTION
      'not allowed for purchase branch %',
      v_branch_id;
  END IF;

  RETURN NEW;

END;
$$;


REVOKE ALL
ON FUNCTION public.enforce_purchase_parent_access()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.enforce_purchase_parent_access()
TO authenticated, service_role;


-- ============================================================
-- 5. SALES
--
-- Protege:
--   create_sale()
--   cancel_sale()
--   refund_sale()
--   cualquier otro SECURITY DEFINER que escriba ventas
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_sales_branch
ON public.sales;

CREATE TRIGGER trg_security_sales_branch
BEFORE INSERT OR UPDATE
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 6. CASH SESSIONS
--
-- Protege:
--   close_cash_session()
--   apertura de caja
--   actualizaciones privilegiadas
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_cash_sessions_branch
ON public.cash_sessions;

CREATE TRIGGER trg_security_cash_sessions_branch
BEFORE INSERT OR UPDATE
ON public.cash_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 7. CASH MOVEMENTS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_cash_movements_branch
ON public.cash_movements;

CREATE TRIGGER trg_security_cash_movements_branch
BEFORE INSERT OR UPDATE
ON public.cash_movements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cash_parent_access();


-- ============================================================
-- 8. PURCHASES
--
-- Protege:
--   create/edit purchase
--   receive_purchase()
--   receive_purchase_partial()
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_purchases_branch
ON public.purchases;

CREATE TRIGGER trg_security_purchases_branch
BEFORE INSERT OR UPDATE
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 9. PURCHASE ITEMS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_purchase_items_branch
ON public.purchase_items;

CREATE TRIGGER trg_security_purchase_items_branch
BEFORE INSERT OR UPDATE
ON public.purchase_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_purchase_parent_access();


-- ============================================================
-- 10. EXPENSES
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_expenses_branch
ON public.expenses;

CREATE TRIGGER trg_security_expenses_branch
BEFORE INSERT OR UPDATE
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 11. CREDIT PAYMENTS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_credit_payments_branch
ON public.credit_payments;

CREATE TRIGGER trg_security_credit_payments_branch
BEFORE INSERT OR UPDATE
ON public.credit_payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 12. ONLINE ORDERS
--
-- Protege:
--   create_online_order()
--   fulfill_online_order()
--   cancel_online_order()
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_online_orders_branch
ON public.online_orders;

CREATE TRIGGER trg_security_online_orders_branch
BEFORE INSERT OR UPDATE
ON public.online_orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 13. INVENTORY MOVEMENTS
--
-- IMPORTANTE:
-- El stock es compartido.
--
-- PERO los movimientos operativos sí llevan branch_id
-- para saber desde qué sucursal ocurrió la operación.
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_inventory_movements_branch
ON public.inventory_movements;

CREATE TRIGGER trg_security_inventory_movements_branch
BEFORE INSERT OR UPDATE
ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 14. SALE PAYMENTS
--
-- sale_payments no tiene branch_id.
-- Hereda la seguridad de sales.
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_sale_payments_branch
ON public.sale_payments;

CREATE TRIGGER trg_security_sale_payments_branch
BEFORE INSERT OR UPDATE
ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sale_parent_access();


-- ============================================================
-- 15. ÍNDICES DE SOPORTE
--
-- Evita búsquedas innecesarias en los triggers.
-- ============================================================

CREATE INDEX IF NOT EXISTS
sales_branch_id_security_idx
ON public.sales(branch_id);

CREATE INDEX IF NOT EXISTS
cash_sessions_branch_id_security_idx
ON public.cash_sessions(branch_id);

CREATE INDEX IF NOT EXISTS
purchases_branch_id_security_idx
ON public.purchases(branch_id);

CREATE INDEX IF NOT EXISTS
expenses_branch_id_security_idx
ON public.expenses(branch_id);

CREATE INDEX IF NOT EXISTS
credit_payments_branch_id_security_idx
ON public.credit_payments(branch_id);

CREATE INDEX IF NOT EXISTS
online_orders_branch_id_security_idx
ON public.online_orders(branch_id);

CREATE INDEX IF NOT EXISTS
inventory_movements_branch_id_security_idx
ON public.inventory_movements(branch_id);


-- ============================================================
-- 16. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.enforce_branch_write_access()
IS
'Lula OS: defensa de sucursal para escrituras normales y RPC SECURITY DEFINER. Inventario central permanece compartido.';

COMMENT ON FUNCTION public.enforce_sale_parent_access()
IS
'Lula OS: valida la sucursal de la venta padre antes de insertar/actualizar sale_payments.';

COMMENT ON FUNCTION public.enforce_cash_parent_access()
IS
'Lula OS: valida la sucursal de la sesión de caja antes de modificar cash_movements.';

COMMENT ON FUNCTION public.enforce_purchase_parent_access()
IS
'Lula OS: valida la sucursal de la compra padre antes de modificar purchase_items.';


COMMIT;