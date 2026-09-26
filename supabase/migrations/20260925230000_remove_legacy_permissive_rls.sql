-- ============================================================
-- LULA OS — ELIMINAR POLÍTICAS RLS PERMISIVAS LEGACY
-- 2026-09-25
--
-- IMPORTANTE:
-- Las políticas antiguas permitían acceso global mediante:
--   USING (true)
--   WITH CHECK (true)
--
-- La migración 20260924200000_harden_auth_activation_and_branch_security.sql
-- creó las políticas seguras por sucursal.
--
-- PostgreSQL combina políticas permisivas mediante OR, por lo que
-- estas políticas antiguas deben eliminarse para que las políticas
-- nuevas realmente restrinjan el acceso.
--
-- NO modifica tablas.
-- NO modifica datos.
-- NO modifica RPCs.
-- NO cambia el inventario compartido.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. GASTOS
-- ============================================================

DROP POLICY IF EXISTS expenses_all_authenticated
ON public.expenses;


-- ============================================================
-- 2. ABONOS DE CRÉDITO
-- ============================================================

DROP POLICY IF EXISTS credit_payments_all_authenticated
ON public.credit_payments;


-- ============================================================
-- 3. ASEGURAR QUE RLS CONTINÚA ACTIVO
-- ============================================================

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credit_payments ENABLE ROW LEVEL SECURITY;


COMMIT;