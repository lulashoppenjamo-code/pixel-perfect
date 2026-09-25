-- ============================================================
-- LULA OS
-- CORRECCIÓN DE FIRMA EXECUTE PARA has_role
-- 2026-09-25
-- ============================================================
--
-- La firma real de has_role es:
--
--   has_role(uuid, public.app_role)
--
-- Algunas migraciones anteriores utilizaron accidentalmente
-- el orden inverso.
--
-- Esta migración deja explícitamente los permisos sobre
-- la firma correcta.
--
-- NO modifica:
-- - usuarios
-- - perfiles
-- - roles
-- - inventario
-- - ventas
-- - caja
-- ============================================================

BEGIN;

REVOKE ALL
ON FUNCTION public.has_role(
  uuid,
  public.app_role
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.has_role(
  uuid,
  public.app_role
)
TO authenticated, service_role;

COMMIT;