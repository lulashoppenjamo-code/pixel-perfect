-- ============================================================
-- LULA OS — Migración evolutiva (FASES 3–5)
-- REVERSIBLE / SAFE: solo ADD COLUMN / CREATE TABLE IF NOT EXISTS
-- NO borra tablas ni datos existentes.
-- Ejecutar en Supabase SQL Editor tras backup.
-- ============================================================

-- 1) Productos: barcode + unidad (si no existen)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'barcode'
  ) THEN
    ALTER TABLE public.products ADD COLUMN barcode text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'unit'
  ) THEN
    ALTER TABLE public.products ADD COLUMN unit text DEFAULT 'pza';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'is_weighable'
  ) THEN
    ALTER TABLE public.products ADD COLUMN is_weighable boolean DEFAULT false;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique
  ON public.products (barcode) WHERE barcode IS NOT NULL AND barcode <> '';

-- 2) Clientes: dirección
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'address'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN address text;
  END IF;
END $$;

-- 3) Ventas: notas
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'notes'
  ) THEN
    ALTER TABLE public.sales ADD COLUMN notes text;
  END IF;
END $$;

-- 4) Crédito / Fiado — abonos
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

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'credit_payments' AND policyname = 'credit_payments_all_authenticated'
  ) THEN
    CREATE POLICY credit_payments_all_authenticated ON public.credit_payments
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5) Gastos
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

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'expenses_all_authenticated'
  ) THEN
    CREATE POLICY expenses_all_authenticated ON public.expenses
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 6) Comentario de rollback (manual)
-- DROP TABLE IF EXISTS public.expenses;
-- DROP TABLE IF EXISTS public.credit_payments;
-- (columnas nuevas se dejan; quitarlas solo si es necesario)
