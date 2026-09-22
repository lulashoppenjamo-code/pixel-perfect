-- ============================================================
-- LULA OS — completa la migración evolutiva (FASES 3-5)
-- Idempotente: solo ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
-- ============================================================

-- 1) Columnas nuevas
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pza';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_weighable boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS notes text;

-- 2) Gastos
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept text NOT NULL,
  category text,
  amount numeric NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'cash',
  notes text,
  branch_id uuid REFERENCES public.branches(id),
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_branch_idx ON public.expenses(branch_id);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON public.expenses(expense_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS r_expenses ON public.expenses;
DROP POLICY IF EXISTS c_expenses ON public.expenses;
DROP POLICY IF EXISTS u_expenses ON public.expenses;
DROP POLICY IF EXISTS d_expenses ON public.expenses;
CREATE POLICY r_expenses ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY c_expenses ON public.expenses FOR INSERT TO authenticated WITH CHECK (created_by IS NULL OR created_by = auth.uid());
CREATE POLICY u_expenses ON public.expenses FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY d_expenses ON public.expenses FOR DELETE TO authenticated USING (public.is_manager());

-- 3) Abonos a fiado
CREATE TABLE IF NOT EXISTS public.credit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'cash',
  notes text,
  branch_id uuid REFERENCES public.branches(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_payments_customer_idx ON public.credit_payments(customer_id);
CREATE INDEX IF NOT EXISTS credit_payments_created_idx ON public.credit_payments(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_payments TO authenticated;
GRANT ALL ON public.credit_payments TO service_role;

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS r_credit_payments ON public.credit_payments;
DROP POLICY IF EXISTS c_credit_payments ON public.credit_payments;
DROP POLICY IF EXISTS u_credit_payments ON public.credit_payments;
DROP POLICY IF EXISTS d_credit_payments ON public.credit_payments;
CREATE POLICY r_credit_payments ON public.credit_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY c_credit_payments ON public.credit_payments FOR INSERT TO authenticated WITH CHECK (created_by IS NULL OR created_by = auth.uid());
CREATE POLICY u_credit_payments ON public.credit_payments FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY d_credit_payments ON public.credit_payments FOR DELETE TO authenticated USING (public.is_manager());

-- 4) Limites de inventario: maximo opcional (permitir "sin maximo")
CREATE OR REPLACE FUNCTION public.set_inventory_limits(
  _branch_id uuid,
  _product_id uuid,
  _min_stock numeric,
  _max_stock numeric DEFAULT NULL,
  _variant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_manager() THEN RAISE EXCEPTION 'not allowed'; END IF;

  INSERT INTO public.inventory (branch_id, product_id, variant_id, stock, min_stock, max_stock)
  VALUES (
    _branch_id,
    _product_id,
    _variant_id,
    0,
    COALESCE(_min_stock, 0),
    _max_stock
  )
  ON CONFLICT (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    min_stock = COALESCE(_min_stock, public.inventory.min_stock),
    max_stock = _max_stock,
    updated_at = now();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_inventory_limits(uuid, uuid, numeric, numeric, uuid) TO authenticated, service_role;