-- ============================================================
-- LULA OS
-- SEGURIDAD — SETTINGS + ACTIVACIÓN DE USUARIOS
-- 2026-09-25
--
-- OBJETIVOS:
-- 1. settings solo puede leerse/escribirse dentro del alcance
--    de la sucursal permitida al usuario.
-- 2. Los ajustes globales siguen disponibles.
-- 3. Owner/admin pueden administrar settings de cualquier
--    sucursal.
-- 4. Manager solo puede administrar settings de su sucursal.
-- 5. La activación/desactivación de usuarios queda protegida
--    por la política existente de profiles para admins.
--
-- NO:
-- - divide inventario
-- - modifica shared_inventory
-- - modifica ventas
-- - modifica caja
-- - modifica compras
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SETTINGS
-- ============================================================

DROP POLICY IF EXISTS r_settings ON public.settings;
DROP POLICY IF EXISTS w_settings ON public.settings;

CREATE POLICY r_settings
ON public.settings
FOR SELECT
TO authenticated
USING (
  branch_id IS NULL
  OR public.can_access_branch(branch_id)
);

CREATE POLICY w_settings
ON public.settings
FOR ALL
TO authenticated
USING (
  public.is_manager()
  AND (
    branch_id IS NULL
    OR public.can_access_branch(branch_id)
  )
)
WITH CHECK (
  public.is_manager()
  AND (
    branch_id IS NULL
    OR public.can_access_branch(branch_id)
  )
);

-- Índice para resolver rápidamente ajustes por sucursal.
CREATE INDEX IF NOT EXISTS settings_branch_key_idx
ON public.settings (branch_id, key);

-- ============================================================
-- 2. PROFILES
-- ============================================================
-- Aseguramos que solamente owner/admin puedan cambiar
-- is_active, branch_id o cualquier dato administrativo.
--
-- Los usuarios normales conservan únicamente la capacidad
-- de modificar su propio perfil mediante la política existente.
-- ============================================================

DROP POLICY IF EXISTS u_own_profile ON public.profiles;

CREATE POLICY u_own_profile
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin()
)
WITH CHECK (
  (
    id = auth.uid()
    AND (
      branch_id IS NOT DISTINCT FROM (
        SELECT p.branch_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
    AND (
      is_active IS NOT DISTINCT FROM (
        SELECT p.is_active
        FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  )
  OR public.is_admin()
);

-- ============================================================
-- 3. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS profiles_branch_active_idx
ON public.profiles (branch_id, is_active);

COMMIT;