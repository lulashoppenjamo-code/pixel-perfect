-- ============================================================
-- Lula Shop OS
-- Normalización de pagos mixtos antiguos
-- ============================================================
--
-- OBJETIVO:
-- Convertir registros históricos de payment_method = 'mixed'
-- en registros reales de cash + card.
--
-- SEGURIDAD:
-- - NO modifica inventario.
-- - NO modifica el total de las ventas.
-- - NO modifica estados de venta.
-- - NO modifica ventas que ya tengan pagos reales.
-- - Solo procesa ventas donde:
--      1. Existe al menos un pago "mixed".
--      2. No existe ningún pago cash/card/transfer/credit.
--      3. sales.cash_received no es NULL.
--
-- Esto permite que caja y devoluciones trabajen con dinero real
-- en lugar de depender del registro histórico "mixed".
-- ============================================================

DO $$
DECLARE
  v_sale RECORD;
  v_mixed RECORD;

  v_total NUMERIC;
  v_cash NUMERIC;
  v_card NUMERIC;

  v_created_at TIMESTAMPTZ;
  v_created_by UUID;

  v_processed INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN

  FOR v_sale IN
    SELECT
      s.id,
      s.total,
      s.cash_received,
      s.cash_session_id,
      s.branch_id
    FROM public.sales s
    WHERE EXISTS (
      SELECT 1
      FROM public.sale_payments sp
      WHERE sp.sale_id = s.id
        AND sp.payment_method = 'mixed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.sale_payments sp
      WHERE sp.sale_id = s.id
        AND sp.payment_method IN (
          'cash',
          'card',
          'transfer',
          'credit'
        )
    )
    AND s.cash_received IS NOT NULL
    ORDER BY s.created_at, s.id
  LOOP

    v_total := COALESCE(v_sale.total, 0);
    v_cash := COALESCE(v_sale.cash_received, 0);

    /*
     * Si el valor histórico de cash_received está fuera
     * del rango permitido, NO tocamos la venta.
     */
    IF v_total < 0
       OR v_cash < 0
       OR v_cash > v_total
    THEN

      v_skipped := v_skipped + 1;

      RAISE NOTICE
        'Venta % omitida: cash_received (%) fuera del rango total (%).',
        v_sale.id,
        v_cash,
        v_total;

      CONTINUE;
    END IF;

    v_card := v_total - v_cash;

    /*
     * Tomamos información del pago mixed original para
     * conservar created_at y created_by cuando sea posible.
     */
    SELECT
      sp.created_at,
      sp.created_by
    INTO
      v_created_at,
      v_created_by
    FROM public.sale_payments sp
    WHERE sp.sale_id = v_sale.id
      AND sp.payment_method = 'mixed'
    ORDER BY sp.created_at
    LIMIT 1;

    /*
     * Si no encontramos created_at por alguna razón,
     * usamos la fecha actual como respaldo.
     */
    v_created_at := COALESCE(v_created_at, NOW());

    /*
     * Eliminamos únicamente los registros mixed de esta venta.
     *
     * Todavía no hay pagos cash/card/etc. gracias al filtro
     * de seguridad anterior.
     */
    DELETE FROM public.sale_payments
    WHERE sale_id = v_sale.id
      AND payment_method = 'mixed';

    /*
     * Crear componente de efectivo.
     */
    IF v_cash > 0 THEN

      INSERT INTO public.sale_payments (
        sale_id,
        payment_method,
        amount,
        reference,
        created_by,
        created_at
      )
      VALUES (
        v_sale.id,
        'cash',
        v_cash,
        'LEGACY_MIXED_NORMALIZED',
        v_created_by,
        v_created_at
      );

    END IF;

    /*
     * Crear componente de tarjeta.
     */
    IF v_card > 0 THEN

      INSERT INTO public.sale_payments (
        sale_id,
        payment_method,
        amount,
        reference,
        created_by,
        created_at
      )
      VALUES (
        v_sale.id,
        'card',
        v_card,
        'LEGACY_MIXED_NORMALIZED',
        v_created_by,
        v_created_at
      );

    END IF;

    v_processed := v_processed + 1;

  END LOOP;

  RAISE NOTICE
    'Normalización de pagos mixtos terminada. Procesadas: %, omitidas: %.',
    v_processed,
    v_skipped;

END $$;


-- ============================================================
-- VERIFICACIÓN
-- ============================================================

/*
 * Esta consulta permite comprobar si todavía quedan
 * pagos mixed históricos que no pudieron normalizarse.
 *
 * No modifica datos.
 */
DO $$
DECLARE
  v_remaining INTEGER;
BEGIN

  SELECT COUNT(*)
  INTO v_remaining
  FROM public.sale_payments sp
  WHERE sp.payment_method = 'mixed';

  RAISE NOTICE
    'Pagos mixed restantes después de la normalización: %.',
    v_remaining;

END $$;