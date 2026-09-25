-- ============================================================
-- LULA OS
-- CORRECCIÓN DE PAGOS MIXTOS
-- 2026-09-25
--
-- OBJETIVO:
--
-- create_sale() actualmente recibe:
--
--   _payment_method = mixed
--   _cash_received  = efectivo recibido
--
-- pero crea inicialmente un solo sale_payment:
--
--   mixed = total
--
-- Esta migración convierte automáticamente ese registro en:
--
--   cash = efectivo
--   card = diferencia
--
-- De esta manera:
--
--   efectivo + tarjeta = total
--
-- y Caja solamente considera el efectivo.
--
-- NO modifica shared_inventory.
-- NO divide inventario por sucursal.
-- NO cambia la firma de create_sale().
-- ============================================================

BEGIN;


-- ============================================================
-- 1. FUNCIÓN PARA NORMALIZAR PAGOS MIXTOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_mixed_sale_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE

  v_sale public.sales;

  v_cash numeric(12,2);
  v_card numeric(12,2);

BEGIN

  -- ==========================================================
  -- SOLAMENTE INTERVENIR CUANDO EL PAGO ORIGINAL ES "MIXED"
  -- ==========================================================

  IF NEW.payment_method <>
     'mixed'::public.payment_method
  THEN
    RETURN NEW;
  END IF;


  -- ==========================================================
  -- OBTENER VENTA
  -- ==========================================================

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = NEW.sale_id;


  IF NOT FOUND THEN
    RETURN NEW;
  END IF;


  -- ==========================================================
  -- EFECTIVO
  --
  -- create_sale() guarda la parte de efectivo en
  -- sales.cash_received.
  -- ==========================================================

  v_cash :=
    ROUND(
      COALESCE(
        v_sale.cash_received,
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


  IF v_cash > v_sale.total THEN
    RAISE EXCEPTION
      'mixed cash amount cannot exceed sale total';
  END IF;


  -- ==========================================================
  -- TARJETA
  -- ==========================================================

  v_card :=
    ROUND(
      v_sale.total - v_cash,
      2
    );


  IF v_card < 0 THEN
    RAISE EXCEPTION
      'mixed card amount cannot be negative';
  END IF;


  -- ==========================================================
  -- ELIMINAR EL PAGO MIXED TEMPORAL
  --
  -- create_sale() ya insertó NEW.
  -- Lo reemplazamos por los pagos reales.
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
      reference,
      created_by
    )
    VALUES (
      NEW.sale_id,
      'cash'::public.payment_method,
      v_cash,
      NULL,
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
      reference,
      created_by
    )
    VALUES (
      NEW.sale_id,
      'card'::public.payment_method,
      v_card,
      NULL,
      NEW.created_by
    );

  END IF;


  -- ==========================================================
  -- DEVOLVER NEW PARA TERMINAR EL TRIGGER
  --
  -- El registro original fue reemplazado.
  -- ==========================================================

  RETURN NULL;

END;
$$;


-- ============================================================
-- 2. SEGURIDAD DE LA FUNCIÓN
-- ============================================================

REVOKE ALL
ON FUNCTION public.normalize_mixed_sale_payment()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.normalize_mixed_sale_payment()
TO authenticated, service_role;


-- ============================================================
-- 3. TRIGGER
--
-- Solamente se dispara cuando:
--
--   payment_method = mixed
--
-- Los registros cash/card que crea la propia función NO vuelven
-- a entrar al bloque de normalización porque ya no son mixed.
-- ============================================================

DROP TRIGGER IF EXISTS
  trg_normalize_mixed_sale_payment
ON public.sale_payments;


CREATE TRIGGER
  trg_normalize_mixed_sale_payment

AFTER INSERT

ON public.sale_payments

FOR EACH ROW

WHEN (
  NEW.payment_method =
  'mixed'::public.payment_method
)

EXECUTE FUNCTION
  public.normalize_mixed_sale_payment();


-- ============================================================
-- 4. ÍNDICE PARA CONSULTAS DE PAGOS
-- ============================================================

CREATE INDEX IF NOT EXISTS
  sale_payments_sale_method_idx

ON public.sale_payments (
  sale_id,
  payment_method
);


COMMIT;