-- ============================================================
-- LULA SHOP OS
-- Permitir que la Edge Function segura verifique PIN
--
-- Migration: 20261004030000
--
-- IMPORTANTE:
-- - NO modifica tablas.
-- - NO modifica RLS.
-- - NO modifica usuarios.
-- - NO modifica permisos.
-- - NO modifica ventas.
-- - NO modifica create_sale().
-- - NO modifica cashier_id.
-- - NO modifica inventario.
--
-- ÚNICAMENTE permite que la Edge Function segura,
-- ejecutada con service_role, pueda ejecutar la función
-- interna verify_collaborator_pin().
-- ============================================================

BEGIN;

GRANT EXECUTE
ON FUNCTION public.verify_collaborator_pin(text, uuid, text)
TO service_role;

COMMIT;