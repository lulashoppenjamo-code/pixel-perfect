-- ============================================================
-- LULA OS — VENTAS APARTADAS / HELD SALES
-- No crea ventas, no descuenta inventario y no mueve caja.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.parked_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  label text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  ticket_discount numeric(12,2) NOT NULL DEFAULT 0,
  cash_received numeric(12,2),
  mixed_cash numeric(12,2),
  mixed_card numeric(12,2),
  notes text,
  cart jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parked_sales_branch_created_idx
  ON public.parked_sales(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS parked_sales_created_by_idx
  ON public.parked_sales(created_by);

ALTER TABLE public.parked_sales ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.parked_sales
TO authenticated;

GRANT ALL
ON public.parked_sales
TO service_role;

DROP POLICY IF EXISTS parked_sales_read
ON public.parked_sales;

CREATE POLICY parked_sales_read
ON public.parked_sales
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);

DROP POLICY IF EXISTS parked_sales_insert
ON public.parked_sales;

CREATE POLICY parked_sales_insert
ON public.parked_sales
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.can_access_branch(branch_id)
);

DROP POLICY IF EXISTS parked_sales_update
ON public.parked_sales;

CREATE POLICY parked_sales_update
ON public.parked_sales
FOR UPDATE
TO authenticated
USING (
  (created_by = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  (created_by = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
);

DROP POLICY IF EXISTS parked_sales_delete
ON public.parked_sales;

CREATE POLICY parked_sales_delete
ON public.parked_sales
FOR DELETE
TO authenticated
USING (
  (created_by = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
);

COMMENT ON TABLE public.parked_sales IS
'LULA OS: venta apartada del POS; no afecta inventario ni caja hasta cobrarse.';

COMMIT;