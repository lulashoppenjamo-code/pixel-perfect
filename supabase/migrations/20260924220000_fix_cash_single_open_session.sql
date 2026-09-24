-- ============================================================
-- LULA OS — CAJA: UNA SOLA SESIÓN ABIERTA POR SUCURSAL
-- ============================================================
-- Objetivo:
--   Impedir que dos dispositivos/usuarios puedan abrir
--   simultáneamente dos cajas para la misma sucursal.
--
-- NO elimina datos.
-- NO modifica ventas.
-- NO modifica inventario.
-- NO modifica sesiones cerradas.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- VALIDACIÓN PREVIA
-- ------------------------------------------------------------
-- Si ya existen dos o más cajas abiertas en una sucursal,
-- detenemos la migración en lugar de eliminar o modificar
-- información histórica automáticamente.
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cash_sessions
    WHERE status = 'open'
    GROUP BY branch_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'No se puede crear la protección de caja: existe más de una sesión abierta en alguna sucursal. Cierra o corrige las sesiones abiertas duplicadas antes de aplicar esta migración.';
  END IF;
END;
$$;


-- ------------------------------------------------------------
-- REGLA CRÍTICA
-- ------------------------------------------------------------
-- Una sucursal puede tener muchas sesiones históricas cerradas,
-- pero solamente UNA sesión abierta.
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS
cash_sessions_one_open_per_branch
ON public.cash_sessions (branch_id)
WHERE status = 'open';


-- ------------------------------------------------------------
-- DOCUMENTACIÓN
-- ------------------------------------------------------------

COMMENT ON INDEX public.cash_sessions_one_open_per_branch
IS
'LULA OS: garantiza que una sucursal tenga como máximo una caja abierta simultáneamente.';


COMMIT;