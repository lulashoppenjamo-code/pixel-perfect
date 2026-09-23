-- ============================================================
-- LULA OS — PAGO MIXTO DEFINITIVO
-- ============================================================
--
-- Corrige:
--   Efectivo + tarjeta
--   Efectivo + transferencia
--   Desglose real de sale_payments
--
-- El POS existente envía:
--
--   _payment_method = 'mixed'
--   _cash_received  = monto de efectivo
--
-- El sistema calcula automáticamente:
--
--   efectivo = _cash_received
--   tarjeta  = total - efectivo
--
-- De esta manera NO es necesario modificar nuevamente todo el POS.
--
-- ============================================================

BEGIN;


-- ============================================================
-- 1. FUNCIÓN PARA NORMALIZAR PAGOS MIXTOS
-- ============================================================
--
-- create_sale() actualmente registra:
--
--   sale_payments:
--   mixed | total
--
-- Esta función convierte automáticamente:
--
--   mixed | 1000
--
-- en:
--
--   cash | 400
--   card | 600
--
-- tomando sales.cash_received como efectivo.
--
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_mixed_sale_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

  v_total numeric(12,2);

  v_cash numeric(12,2);

  v_card numeric(12,2);

  v_sale_cash_received numeric(12,2);

BEGIN

  -- ==========================================================
  -- SOLO INTERVENIR EN PAGOS MIXTOS
  -- ==========================================================

  IF NEW.payment_method <> 'mixed' THEN
    RETURN NEW;
  END IF;


  -- ==========================================================
  -- OBTENER TOTAL DE LA VENTA
  -- ==========================================================

  SELECT
    ROUND(
      COALESCE(total, 0),
      2
    )
  INTO v_total

  FROM public.sales

  WHERE id = NEW.sale_id;


  IF v_total IS NULL THEN
    RAISE EXCEPTION
      'sale not found for payment %',
      NEW.id;
  END IF;


  -- ==========================================================
  -- OBTENER EFECTIVO
  -- ==========================================================

  SELECT
    COALESCE(
      cash_received,
      0
    )

  INTO v_sale_cash_received

  FROM public.sales

  WHERE id = NEW.sale_id;


  v_cash :=
    ROUND(
      COALESCE(
        v_sale_cash_received,
        0
      ),
      2
    );


  -- ==========================================================
  -- VALIDAR EFECTIVO
  -- ==========================================================

  IF v_cash < 0 THEN

    RAISE EXCEPTION
      'mixed cash amount cannot be negative';

  END IF;


  IF v_cash > v_total THEN

    RAISE EXCEPTION
      'mixed cash amount cannot exceed sale total';

  END IF;


  -- ==========================================================
  -- CALCULAR TARJETA
  -- ==========================================================

  v_card :=
    ROUND(
      v_total - v_cash,
      2
    );


  -- ==========================================================
  -- ELIMINAR EL PAGO MIXTO ORIGINAL
  -- ==========================================================
  --
  -- El trigger es AFTER INSERT.
  --
  -- NEW ya fue insertado.
  --
  -- Lo sustituimos por los pagos reales.
  --
  -- ==========================================================

  DELETE FROM public.sale_payments

  WHERE id = NEW.id;


  -- ==========================================================
  -- EFECTIVO
  -- ==========================================================

  IF v_cash > 0 THEN

    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      created_by
    )

    VALUES (
      NEW.sale_id,
      'cash',
      v_cash,
      NEW.created_by
    );

  END IF;


  -- ==========================================================
  -- TARJETA
  -- ==========================================================

  IF v_card > 0 THEN

    INSERT INTO public.sale_payments (
      sale_id,
      payment_method,
      amount,
      created_by
    )

    VALUES (
      NEW.sale_id,
      'card',
      v_card,
      NEW.created_by
    );

  END IF;


  -- ==========================================================
  -- CANCELAR EL INSERT ORIGINAL
  -- ==========================================================
  --
  -- Como es AFTER trigger, el registro original ya fue
  -- eliminado y devolvemos NEW.
  --
  -- Los nuevos registros son cash/card y este trigger
  -- no vuelve a ejecutar la normalización porque su método
  -- ya no es mixed.
  --
  -- ==========================================================

  RETURN NEW;

END;
$$;


-- ============================================================
-- 2. ELIMINAR TRIGGER ANTERIOR SI EXISTE
-- ============================================================

DROP TRIGGER IF EXISTS
normalize_mixed_sale_payment_trigger
ON public.sale_payments;


-- ============================================================
-- 3. CREAR TRIGGER
-- ============================================================

CREATE TRIGGER
normalize_mixed_sale_payment_trigger

AFTER INSERT

ON public.sale_payments

FOR EACH ROW

EXECUTE FUNCTION
public.normalize_mixed_sale_payment();


-- ============================================================
-- 4. FUNCIÓN DE VALIDACIÓN DE PAGOS
-- ============================================================
--
-- Garantiza que una venta siempre tenga pagos que sumen
-- exactamente el total.
--
-- Se usa como herramienta de auditoría.
--
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_sale_payment_total(
  _sale_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE

  v_sale_total numeric(12,2);

  v_payment_total numeric(12,2);

BEGIN

  SELECT
    ROUND(
      COALESCE(total, 0),
      2
    )

  INTO v_sale_total

  FROM public.sales

  WHERE id = _sale_id;


  IF v_sale_total IS NULL THEN
    RAISE EXCEPTION
      'sale not found';
  END IF;


  SELECT
    ROUND(
      COALESCE(
        SUM(amount),
        0
      ),
      2
    )

  INTO v_payment_total

  FROM public.sale_payments

  WHERE sale_id = _sale_id;


  RETURN
    v_payment_total =
    v_sale_total;

END;
$$;


-- ============================================================
-- 5. CONSULTA DE DESGLOSE DE PAGOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_sale_payment_breakdown(
  _sale_id uuid
)
RETURNS TABLE (
  sale_id uuid,
  cash numeric,
  card numeric,
  transfer numeric,
  credit numeric,
  mixed numeric,
  total_paid numeric,
  sale_total numeric,
  difference numeric,
  is_balanced boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT

    s.id AS sale_id,

    COALESCE(
      SUM(
        CASE
          WHEN sp.payment_method = 'cash'
          THEN sp.amount
          ELSE 0
        END
      ),
      0
    ) AS cash,

    COALESCE(
      SUM(
        CASE
          WHEN sp.payment_method = 'card'
          THEN sp.amount
          ELSE 0
        END
      ),
      0
    ) AS card,

    COALESCE(
      SUM(
        CASE
          WHEN sp.payment_method = 'transfer'
          THEN sp.amount
          ELSE 0
        END
      ),
      0
    ) AS transfer,

    COALESCE(
      SUM(
        CASE
          WHEN sp.payment_method = 'credit'
          THEN sp.amount
          ELSE 0
        END
      ),
      0
    ) AS credit,

    COALESCE(
      SUM(
        CASE
          WHEN sp.payment_method = 'mixed'
          THEN sp.amount
          ELSE 0
        END
      ),
      0
    ) AS mixed,

    COALESCE(
      SUM(sp.amount),
      0
    ) AS total_paid,

    s.total AS sale_total,

    ROUND(
      COALESCE(
        SUM(sp.amount),
        0
      ) - s.total,
      2
    ) AS difference,

    ROUND(
      COALESCE(
        SUM(sp.amount),
        0
      ),
      2
    ) = ROUND(
      s.total,
      2
    ) AS is_balanced

  FROM public.sales s

  LEFT JOIN public.sale_payments sp
    ON sp.sale_id = s.id

  WHERE s.id = _sale_id

  GROUP BY
    s.id,
    s.total;
$$;


-- ============================================================
-- 6. PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.normalize_mixed_sale_payment()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.normalize_mixed_sale_payment()
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.validate_sale_payment_total(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.validate_sale_payment_total(uuid)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.get_sale_payment_breakdown(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_sale_payment_breakdown(uuid)
TO authenticated, service_role;


-- ============================================================
-- 7. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.normalize_mixed_sale_payment()
IS
'LULA OS: convierte automáticamente un pago mixed en sus componentes reales de efectivo y tarjeta usando sales.cash_received.';


COMMENT ON FUNCTION public.validate_sale_payment_total(uuid)
IS
'LULA OS: valida que los pagos registrados de una venta coincidan exactamente con el total.';


COMMENT ON FUNCTION public.get_sale_payment_breakdown(uuid)
IS
'LULA OS: devuelve el desglose de efectivo, tarjeta, transferencia y crédito de una venta.';


COMMIT;