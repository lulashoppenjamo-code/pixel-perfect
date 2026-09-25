-- ============================================================
-- LULA OS — SEGURIDAD FINAL DE AUTENTICACIÓN Y SUCURSALES
-- 2026-09-24
--
-- Objetivos:
-- 1. Usuarios nuevos NO reciben automáticamente staff.
-- 2. El primer usuario sigue siendo owner + activo.
-- 3. Usuarios posteriores quedan inactivos hasta ser autorizados.
-- 4. has_role/is_manager/is_admin respetan is_active.
-- 5. Managers trabajan solamente con su sucursal.
-- 6. Owner/admin pueden administrar todas las sucursales.
-- 7. Inventario continúa siendo COMPARTIDO.
-- 8. No se crean tablas nuevas.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. FUNCIÓN CENTRAL DE ACCESO A SUCURSAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_branch(
  _branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND _branch_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND (
          EXISTS (
            SELECT 1
            FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('owner', 'admin')
          )
          OR (
            EXISTS (
              SELECT 1
              FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = 'manager'
            )
            AND p.branch_id = _branch_id
          )
          OR p.branch_id = _branch_id
        )
    );
$$;

REVOKE ALL
ON FUNCTION public.can_access_branch(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.can_access_branch(uuid)
TO authenticated, service_role;


-- ============================================================
-- 2. has_role — SOLAMENTE USUARIOS ACTIVOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = _user_id
      AND p.is_active = true
      AND ur.role = _role
  );
$$;

REVOKE ALL
ON FUNCTION public.has_role(uuid, public.app_role)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_role(uuid, public.app_role)
TO authenticated, service_role;


-- ============================================================
-- 3. is_manager — SOLAMENTE USUARIOS ACTIVOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND ur.role IN ('owner', 'admin', 'manager')
  );
$$;

REVOKE ALL
ON FUNCTION public.is_manager()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_manager()
TO authenticated, service_role;


-- ============================================================
-- 4. is_admin — SOLAMENTE USUARIOS ACTIVOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND ur.role IN ('owner', 'admin')
  );
$$;

REVOKE ALL
ON FUNCTION public.is_admin()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_admin()
TO authenticated, service_role;


-- ============================================================
-- 5. ensure_profile
--
-- PRIMER USUARIO:
--   owner + activo
--
-- USUARIOS POSTERIORES:
--   sin rol automático
--   inactivo
--
-- IMPORTANTE:
-- NO reactiva perfiles existentes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_profile(
  _full_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing_profile boolean;
  any_user boolean;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = uid
  )
  INTO existing_profile;

  IF existing_profile THEN

    UPDATE public.profiles
    SET
      full_name = COALESCE(
        public.profiles.full_name,
        _full_name
      ),
      updated_at = now()
    WHERE id = uid;

    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
  )
  INTO any_user;

  IF NOT any_user THEN

    INSERT INTO public.profiles (
      id,
      full_name,
      is_active
    )
    VALUES (
      uid,
      _full_name,
      true
    );

    INSERT INTO public.user_roles (
      user_id,
      role
    )
    VALUES (
      uid,
      'owner'
    );

  ELSE

    INSERT INTO public.profiles (
      id,
      full_name,
      is_active
    )
    VALUES (
      uid,
      _full_name,
      false
    );

  END IF;

END;
$$;

REVOKE ALL
ON FUNCTION public.ensure_profile(text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.ensure_profile(text)
TO authenticated, service_role;


-- ============================================================
-- 6. SUCURSALES — POLÍTICAS
-- ============================================================

DROP POLICY IF EXISTS r_branches
ON public.branches;

CREATE POLICY r_branches
ON public.branches
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
  )
);


-- ============================================================
-- 7. SALES — LECTURA POR SUCURSAL
-- ============================================================

DROP POLICY IF EXISTS r_sales
ON public.sales;

CREATE POLICY r_sales
ON public.sales
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS c_sales
ON public.sales;

CREATE POLICY c_sales
ON public.sales
FOR INSERT
TO authenticated
WITH CHECK (
  cashier_id = auth.uid()
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS u_sales
ON public.sales;

CREATE POLICY u_sales
ON public.sales
FOR UPDATE
TO authenticated
USING (
  (cashier_id = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  (cashier_id = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
);


-- ============================================================
-- 8. SALE ITEMS — HEREDAN SEGURIDAD DE LA VENTA
-- ============================================================

DROP POLICY IF EXISTS r_sale_items
ON public.sale_items;

CREATE POLICY r_sale_items
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND public.can_access_branch(s.branch_id)
  )
);


DROP POLICY IF EXISTS c_sale_items
ON public.sale_items;

CREATE POLICY c_sale_items
ON public.sale_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND (
        s.cashier_id = auth.uid()
        OR public.is_manager()
      )
      AND public.can_access_branch(s.branch_id)
  )
);


DROP POLICY IF EXISTS u_sale_items
ON public.sale_items;

CREATE POLICY u_sale_items
ON public.sale_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND public.can_access_branch(s.branch_id)
      AND public.is_manager()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND public.can_access_branch(s.branch_id)
      AND public.is_manager()
  )
);


-- ============================================================
-- 9. SALE PAYMENTS — HEREDAN SEGURIDAD DE LA VENTA
-- ============================================================

DROP POLICY IF EXISTS r_sale_payments
ON public.sale_payments;

CREATE POLICY r_sale_payments
ON public.sale_payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND public.can_access_branch(s.branch_id)
  )
);


DROP POLICY IF EXISTS c_sale_payments
ON public.sale_payments;

CREATE POLICY c_sale_payments
ON public.sale_payments
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by = auth.uid() OR created_by IS NULL)
  AND EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_id
      AND public.can_access_branch(s.branch_id)
  )
);


-- ============================================================
-- 10. CASH SESSIONS
-- ============================================================

DROP POLICY IF EXISTS r_cash_sessions
ON public.cash_sessions;

CREATE POLICY r_cash_sessions
ON public.cash_sessions
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS c_cash_sessions
ON public.cash_sessions;

CREATE POLICY c_cash_sessions
ON public.cash_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  opened_by = auth.uid()
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS u_cash_sessions
ON public.cash_sessions;

CREATE POLICY u_cash_sessions
ON public.cash_sessions
FOR UPDATE
TO authenticated
USING (
  (opened_by = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  (opened_by = auth.uid() OR public.is_manager())
  AND public.can_access_branch(branch_id)
);


-- ============================================================
-- 11. CASH MOVEMENTS
-- ============================================================

DROP POLICY IF EXISTS r_cash_movements
ON public.cash_movements;

CREATE POLICY r_cash_movements
ON public.cash_movements
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cash_sessions cs
    WHERE cs.id = cash_session_id
      AND public.can_access_branch(cs.branch_id)
  )
);


DROP POLICY IF EXISTS c_cash_movements
ON public.cash_movements;

CREATE POLICY c_cash_movements
ON public.cash_movements
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.cash_sessions cs
    WHERE cs.id = cash_session_id
      AND (
        cs.opened_by = auth.uid()
        OR public.is_manager()
      )
      AND public.can_access_branch(cs.branch_id)
  )
);


-- ============================================================
-- 12. PURCHASES
-- ============================================================

DROP POLICY IF EXISTS r_purchases
ON public.purchases;

CREATE POLICY r_purchases
ON public.purchases
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS w_purchases
ON public.purchases;

CREATE POLICY w_purchases
ON public.purchases
FOR ALL
TO authenticated
USING (
  public.is_manager()
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  public.is_manager()
  AND public.can_access_branch(branch_id)
);


-- ============================================================
-- 13. PURCHASE ITEMS
-- ============================================================

DROP POLICY IF EXISTS r_purchase_items
ON public.purchase_items;

CREATE POLICY r_purchase_items
ON public.purchase_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.purchases p
    WHERE p.id = purchase_id
      AND public.can_access_branch(p.branch_id)
  )
);


DROP POLICY IF EXISTS w_purchase_items
ON public.purchase_items;

CREATE POLICY w_purchase_items
ON public.purchase_items
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.purchases p
    WHERE p.id = purchase_id
      AND public.is_manager()
      AND public.can_access_branch(p.branch_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.purchases p
    WHERE p.id = purchase_id
      AND public.is_manager()
      AND public.can_access_branch(p.branch_id)
  )
);


-- ============================================================
-- 14. EXPENSES
-- ============================================================

DROP POLICY IF EXISTS r_expenses
ON public.expenses;

CREATE POLICY r_expenses
ON public.expenses
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS c_expenses
ON public.expenses;

CREATE POLICY c_expenses
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by IS NULL OR created_by = auth.uid())
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS u_expenses
ON public.expenses;

CREATE POLICY u_expenses
ON public.expenses
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  public.is_manager()
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS d_expenses
ON public.expenses;

CREATE POLICY d_expenses
ON public.expenses
FOR DELETE
TO authenticated
USING (
  public.is_manager()
  AND public.can_access_branch(branch_id)
);


-- ============================================================
-- 15. CREDIT PAYMENTS
-- ============================================================

DROP POLICY IF EXISTS r_credit_payments
ON public.credit_payments;

CREATE POLICY r_credit_payments
ON public.credit_payments
FOR SELECT
TO authenticated
USING (
  public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS c_credit_payments
ON public.credit_payments;

CREATE POLICY c_credit_payments
ON public.credit_payments
FOR INSERT
TO authenticated
WITH CHECK (
  (created_by IS NULL OR created_by = auth.uid())
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS u_credit_payments
ON public.credit_payments;

CREATE POLICY u_credit_payments
ON public.credit_payments
FOR UPDATE
TO authenticated
USING (
  public.is_manager()
  AND public.can_access_branch(branch_id)
)
WITH CHECK (
  public.is_manager()
  AND public.can_access_branch(branch_id)
);


DROP POLICY IF EXISTS d_credit_payments
ON public.credit_payments;

CREATE POLICY d_credit_payments
ON public.credit_payments
FOR DELETE
TO authenticated
USING (
  public.is_manager()
  AND public.can_access_branch(branch_id)
);


-- ============================================================
-- 16. INVENTARIO
--
-- NO SE CAMBIA A INVENTARIO POR SUCURSAL.
-- EL INVENTARIO DE LULA OS SIGUE SIENDO COMPARTIDO.
--
-- Solamente aseguramos que usuarios inactivos no puedan leerlo.
-- ============================================================

DROP POLICY IF EXISTS r_inventory
ON public.inventory;

CREATE POLICY r_inventory
ON public.inventory
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
  )
);


-- ============================================================
-- 17. PROFILES
-- ============================================================

DROP POLICY IF EXISTS r_profiles
ON public.profiles;

CREATE POLICY r_profiles
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
);


DROP POLICY IF EXISTS u_own_profile
ON public.profiles;

CREATE POLICY u_own_profile
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
)
WITH CHECK (
  id = auth.uid()
  OR public.is_admin()
);


-- ============================================================
-- 18. USER ROLES
-- ============================================================

DROP POLICY IF EXISTS r_user_roles
ON public.user_roles;

CREATE POLICY r_user_roles
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin()
);


DROP POLICY IF EXISTS w_user_roles
ON public.user_roles;

CREATE POLICY w_user_roles
ON public.user_roles
FOR ALL
TO authenticated
USING (
  public.is_admin()
)
WITH CHECK (
  public.is_admin()
);


COMMIT;