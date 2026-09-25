-- ============================================================
-- LULA OS
-- FIX — RPC SECURITY HARDENING
-- 2026-09-24
--
-- Corrige el bloque de seguridad anterior.
--
-- IMPORTANTE:
-- No depende de tablas que no estén confirmadas.
-- No toca shared_inventory.
-- No divide inventario por sucursal.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. VALIDACIÓN DE ESCRITURAS CON branch_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_branch_write_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION
      'branch_id is required for %',
      TG_TABLE_NAME;
  END IF;

  IF NOT public.can_access_branch(NEW.branch_id) THEN
    RAISE EXCEPTION
      'not allowed for branch %',
      NEW.branch_id;
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
-- 2. VENTAS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_sales_branch
ON public.sales;

CREATE TRIGGER trg_security_sales_branch
BEFORE INSERT OR UPDATE
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 3. CAJAS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_cash_sessions_branch
ON public.cash_sessions;

CREATE TRIGGER trg_security_cash_sessions_branch
BEFORE INSERT OR UPDATE
ON public.cash_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 4. COMPRAS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_purchases_branch
ON public.purchases;

CREATE TRIGGER trg_security_purchases_branch
BEFORE INSERT OR UPDATE
ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 5. GASTOS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_expenses_branch
ON public.expenses;

CREATE TRIGGER trg_security_expenses_branch
BEFORE INSERT OR UPDATE
ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 6. CREDIT PAYMENTS
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_credit_payments_branch
ON public.credit_payments;

CREATE TRIGGER trg_security_credit_payments_branch
BEFORE INSERT OR UPDATE
ON public.credit_payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 7. INVENTORY MOVEMENTS
--
-- El INVENTARIO sigue siendo compartido.
-- Solamente el movimiento conserva la sucursal de origen.
-- ============================================================

DROP TRIGGER IF EXISTS trg_security_inventory_movements_branch
ON public.inventory_movements;

CREATE TRIGGER trg_security_inventory_movements_branch
BEFORE INSERT OR UPDATE
ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_branch_write_access();


-- ============================================================
-- 8. PAGOS DE VENTA
--
-- sale_payments no tiene branch_id.
-- Validamos mediante la venta padre.
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
  FROM public.sales AS s
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


DROP TRIGGER IF EXISTS trg_security_sale_payments_branch
ON public.sale_payments;

CREATE TRIGGER trg_security_sale_payments_branch
BEFORE INSERT OR UPDATE
ON public.sale_payments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sale_parent_access();


-- ============================================================
-- 9. MOVIMIENTOS DE CAJA
--
-- cash_movements -> cash_sessions -> branch_id
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
  FROM public.cash_sessions AS cs
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


DROP TRIGGER IF EXISTS trg_security_cash_movements_branch
ON public.cash_movements;

CREATE TRIGGER trg_security_cash_movements_branch
BEFORE INSERT OR UPDATE
ON public.cash_movements
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cash_parent_access();


-- ============================================================
-- 10. PURCHASE ITEMS
--
-- purchase_items -> purchases -> branch_id
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
  FROM public.purchases AS p
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


DROP TRIGGER IF EXISTS trg_security_purchase_items_branch
ON public.purchase_items;

CREATE TRIGGER trg_security_purchase_items_branch
BEFORE INSERT OR UPDATE
ON public.purchase_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_purchase_parent_access();


-- ============================================================
-- 11. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_sales_branch_security
ON public.sales(branch_id);

CREATE INDEX IF NOT EXISTS
idx_cash_sessions_branch_security
ON public.cash_sessions(branch_id);

CREATE INDEX IF NOT EXISTS
idx_purchases_branch_security
ON public.purchases(branch_id);

CREATE INDEX IF NOT EXISTS
idx_expenses_branch_security
ON public.expenses(branch_id);

CREATE INDEX IF NOT EXISTS
idx_credit_payments_branch_security
ON public.credit_payments(branch_id);

CREATE INDEX IF NOT EXISTS
idx_inventory_movements_branch_security
ON public.inventory_movements(branch_id);


-- ============================================================
-- 12. COMENTARIOS
-- ============================================================

COMMENT ON FUNCTION public.enforce_branch_write_access()
IS
'Lula OS: valida branch_id antes de escrituras operativas.';

COMMENT ON FUNCTION public.enforce_sale_parent_access()
IS
'Lula OS: valida sucursal mediante la venta padre.';

COMMENT ON FUNCTION public.enforce_cash_parent_access()
IS
'Lula OS: valida sucursal mediante la sesión de caja padre.';

COMMENT ON FUNCTION public.enforce_purchase_parent_access()
IS
'Lula OS: valida sucursal mediante la compra padre.';


COMMIT;