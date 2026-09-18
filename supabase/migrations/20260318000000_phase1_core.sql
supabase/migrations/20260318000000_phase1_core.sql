-- ============================================================
-- Lula Shop OS — FASE 1: Núcleo empresarial
-- Ejecutar en Supabase SQL Editor o vía supabase db push
-- ============================================================

-- 1) Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) Settings: keys de configuración del negocio
INSERT INTO public.settings (key, value)
VALUES
  ('require_open_cash_session', 'true'::jsonb),
  ('block_sale_without_stock', 'true'::jsonb),
  ('allow_negative_stock', 'false'::jsonb),
  ('company_name', '"Lula Shop"'::jsonb),
  ('ticket_footer', '"¡Gracias por su compra!"'::jsonb),
  ('default_tax_rate', '0.16'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3) Sucursal principal (seed)
INSERT INTO public.branches (id, name, address, phone, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Sucursal Principal',
  'Dirección principal',
  NULL,
  true
)
ON CONFLICT (id) DO NOTHING;

-- 4) Categorías base
INSERT INTO public.categories (id, name, parent_id)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'General', NULL),
  ('10000000-0000-0000-0000-000000000002', 'Bebidas', NULL),
  ('10000000-0000-0000-0000-000000000003', 'Snacks', NULL),
  ('10000000-0000-0000-0000-000000000004', 'Otros', NULL)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5) Helpers de roles (si no existen ya)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin', 'manager')
  );
$$;

-- ============================================================
-- 6) ensure_profile: crea perfil + rol cashier por defecto
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_profile(_full_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.profiles (id, full_name, branch_id)
  VALUES (
    uid,
    COALESCE(_full_name, split_part(auth.jwt() ->> 'email', '@', 1)),
    '00000000-0000-0000-0000-000000000001'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        updated_at = now();

  -- Primer usuario del sistema → owner; resto → cashier
  IF NOT EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, 'owner')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, 'cashier')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- ============================================================
-- 7) create_sale mejorado (FASE 1 + base FASE 2)
--    - Exige caja abierta si setting lo pide
--    - Bloquea sin stock si setting lo pide
--    - Folio por sucursal
--    - Descuento ticket + descuento por línea
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_sale(
  _branch_id uuid,
  _items jsonb,
  _payment_method public.payment_method DEFAULT 'cash',
  _customer_id uuid DEFAULT NULL,
  _cash_session_id uuid DEFAULT NULL,
  _discount numeric DEFAULT 0,
  _cash_received numeric DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql

... 