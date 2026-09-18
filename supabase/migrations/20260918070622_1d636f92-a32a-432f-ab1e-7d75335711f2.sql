-- ENUMS
CREATE TYPE public.app_role AS ENUM ('owner','admin','manager','cashier','staff');
CREATE TYPE public.movement_type AS ENUM ('sale','return','purchase','adjustment_in','adjustment_out','transfer_in','transfer_out');
CREATE TYPE public.purchase_status AS ENUM ('draft','ordered','received','cancelled');
CREATE TYPE public.payment_method AS ENUM ('cash','card','transfer','credit','mixed');
CREATE TYPE public.sale_status AS ENUM ('completed','cancelled','refunded','partially_refunded');
CREATE TYPE public.cash_session_status AS ENUM ('open','closed');
CREATE TYPE public.cash_movement_type AS ENUM ('deposit','withdrawal');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- BRANCHES
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('owner','admin','manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  );
$$;

-- Bootstrap profile + default role for the signed-in user
CREATE OR REPLACE FUNCTION public.ensure_profile(_full_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.profiles (id, full_name)
  VALUES (uid, _full_name)
  ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid) THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'owner');
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'staff');
    END IF;
  END IF;
END; $$;

-- CATEGORIES
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PRODUCTS
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  name text NOT NULL,
  description text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,4) NOT NULL DEFAULT 0,
  emoji text,
  image_url text,
  has_variants boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text UNIQUE,
  name text NOT NULL,
  price_override numeric(12,2),
  cost_override numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- INVENTORY
CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  stock numeric(12,2) NOT NULL DEFAULT 0,
  min_stock numeric(12,2) NOT NULL DEFAULT 0,
  max_stock numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_unique_combo ON public.inventory (branch_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  type public.movement_type NOT NULL,
  quantity numeric(12,2) NOT NULL,
  reference_id uuid,
  reference_type text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- CUSTOMERS / SUPPLIERS
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PURCHASES
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status public.purchase_status NOT NULL DEFAULT 'draft',
  total numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- CASH SESSIONS
CREATE TABLE public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL,
  closed_by uuid,
  opening_amount numeric(12,2) NOT NULL DEFAULT 0,
  closing_amount numeric(12,2),
  expected_amount numeric(12,2),
  difference numeric(12,2),
  status public.cash_session_status NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  type public.cash_movement_type NOT NULL,
  amount numeric(12,2) NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SALES
CREATE SEQUENCE public.sales_folio_seq START 1;
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio bigint NOT NULL UNIQUE DEFAULT nextval('public.sales_folio_seq'),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  cash_received numeric(12,2),
  change_given numeric(12,2),
  status public.sale_status NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE public.sales_folio_seq OWNED BY public.sales.folio;

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  name_snapshot text NOT NULL,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SETTINGS
CREATE TABLE public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX settings_unique_key ON public.settings (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- updated_at triggers
CREATE TRIGGER t_branches_u BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_profiles_u BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_categories_u BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_products_u BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_variants_u BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_inventory_u BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_customers_u BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_suppliers_u BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_purchases_u BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_cash_sessions_u BEFORE UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_sales_u BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER t_settings_u BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches, public.profiles, public.categories, public.products, public.product_variants, public.inventory, public.inventory_movements, public.customers, public.suppliers, public.purchases, public.purchase_items, public.cash_sessions, public.cash_movements, public.sales, public.sale_items, public.settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.sales_folio_seq TO authenticated;
GRANT ALL ON public.branches, public.profiles, public.user_roles, public.categories, public.products, public.product_variants, public.inventory, public.inventory_movements, public.customers, public.suppliers, public.purchases, public.purchase_items, public.cash_sessions, public.cash_movements, public.sales, public.sale_items, public.settings TO service_role;

-- RLS
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- read for all authenticated
CREATE POLICY r_branches ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY r_categories ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY r_products ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY r_variants ON public.product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY r_inventory ON public.inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY r_movements ON public.inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY r_customers ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY r_suppliers ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY r_purchases ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY r_purchase_items ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY r_cash_sessions ON public.cash_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY r_cash_movements ON public.cash_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY r_sales ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY r_sale_items ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY r_settings ON public.settings FOR SELECT TO authenticated USING (true);

-- manager-managed catalog tables
CREATE POLICY w_branches ON public.branches FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY w_categories ON public.categories FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_products ON public.products FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_variants ON public.product_variants FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_inventory ON public.inventory FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_customers ON public.customers FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_suppliers ON public.suppliers FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_purchases ON public.purchases FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_purchase_items ON public.purchase_items FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY w_settings ON public.settings FOR ALL TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());

-- inventory movements: anyone authenticated can log their own movement
CREATE POLICY c_movements ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY ud_movements ON public.inventory_movements FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY d_movements ON public.inventory_movements FOR DELETE TO authenticated USING (public.is_manager());

-- sales
CREATE POLICY c_sales ON public.sales FOR INSERT TO authenticated WITH CHECK (cashier_id = auth.uid());
CREATE POLICY u_sales ON public.sales FOR UPDATE TO authenticated USING (cashier_id = auth.uid() OR public.is_manager()) WITH CHECK (cashier_id = auth.uid() OR public.is_manager());
CREATE POLICY d_sales ON public.sales FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY c_sale_items ON public.sale_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND (s.cashier_id = auth.uid() OR public.is_manager())));
CREATE POLICY u_sale_items ON public.sale_items FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY d_sale_items ON public.sale_items FOR DELETE TO authenticated USING (public.is_manager());

-- cash sessions: own sessions
CREATE POLICY c_cash_sessions ON public.cash_sessions FOR INSERT TO authenticated WITH CHECK (opened_by = auth.uid());
CREATE POLICY u_cash_sessions ON public.cash_sessions FOR UPDATE TO authenticated USING (opened_by = auth.uid() OR public.is_manager()) WITH CHECK (opened_by = auth.uid() OR public.is_manager());
CREATE POLICY d_cash_sessions ON public.cash_sessions FOR DELETE TO authenticated USING (public.is_admin());

CREATE POLICY c_cash_movements ON public.cash_movements FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.id = cash_session_id AND (cs.opened_by = auth.uid() OR public.is_manager())));
CREATE POLICY u_cash_movements ON public.cash_movements FOR UPDATE TO authenticated USING (public.is_manager()) WITH CHECK (public.is_manager());
CREATE POLICY d_cash_movements ON public.cash_movements FOR DELETE TO authenticated USING (public.is_manager());

-- profiles
CREATE POLICY r_profiles ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY u_own_profile ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin()) WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY c_own_profile ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.is_admin());
CREATE POLICY d_profiles ON public.profiles FOR DELETE TO authenticated USING (public.is_admin());

-- user roles
CREATE POLICY r_user_roles ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY w_user_roles ON public.user_roles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());