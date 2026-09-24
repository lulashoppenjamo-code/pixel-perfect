-- ============================================================
-- LULA OS — CORRECCIÓN MOTOR DE REPORTES
-- ============================================================
-- Corrige la llamada a is_manager().
-- El proyecto utiliza:
--
--   public.is_manager()
--
-- y NO:
--
--   public.is_manager(uid)
--
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_reports_summary(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL,
  _timezone text DEFAULT 'America/Mexico_City'
)
RETURNS TABLE (
  sales_total numeric,
  tickets bigint,
  average_ticket numeric,

  historical_cost numeric,
  gross_profit numeric,
  gross_margin numeric,

  expenses_total numeric,
  net_profit numeric,

  previous_sales_total numeric,
  previous_tickets bigint,
  previous_average_ticket numeric,

  previous_historical_cost numeric,
  previous_gross_profit numeric,
  previous_gross_margin numeric,

  previous_expenses_total numeric,
  previous_net_profit numeric,

  sales_change_percent numeric,
  profit_change_percent numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();

  v_period_days integer;
  v_previous_from date;
  v_previous_to date;

  v_sales_total numeric := 0;
  v_tickets bigint := 0;

  v_cost numeric := 0;
  v_revenue numeric := 0;
  v_expenses numeric := 0;

  v_prev_sales numeric := 0;
  v_prev_tickets bigint := 0;
  v_prev_cost numeric := 0;
  v_prev_revenue numeric := 0;
  v_prev_expenses numeric := 0;
BEGIN

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF _from IS NULL OR _to IS NULL THEN
    RAISE EXCEPTION 'El periodo es obligatorio';
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'El periodo es inválido';
  END IF;


  -- ==========================================================
  -- SEGURIDAD DE SUCURSAL
  -- ==========================================================

  IF _branch_id IS NOT NULL
     AND NOT public.is_manager()
     AND NOT public.is_admin()
  THEN

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = uid
        AND p.branch_id = _branch_id
        AND COALESCE(
          p.is_active,
          false
        ) = true
    ) THEN

      RAISE EXCEPTION
        'No tienes acceso a esta sucursal';

    END IF;

  END IF;


  -- ==========================================================
  -- PERIODO ANTERIOR
  -- ==========================================================

  v_period_days :=
    (_to - _from) + 1;

  v_previous_to :=
    _from - 1;

  v_previous_from :=
    v_previous_to
    - v_period_days
    + 1;


  -- ==========================================================
  -- VENTAS ACTUALES
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(s.total),
      0
    ),
    COUNT(*)::bigint

  INTO
    v_sales_total,
    v_tickets

  FROM public.sales s

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND timezone(
    _timezone,
    s.created_at
  )::date
  BETWEEN _from AND _to;


  -- ==========================================================
  -- INGRESO Y COSTO HISTÓRICO
  -- ==========================================================

  SELECT

    COALESCE(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            si.total
            *
            (
              GREATEST(
                si.quantity
                -
                COALESCE(
                  si.returned_quantity,
                  0
                ),
                0
              )
              /
              si.quantity
            )
          ELSE 0
        END
      ),
      0
    ),

    COALESCE(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            COALESCE(
              si.cost_total,
              0
            )
            *
            (
              GREATEST(
                si.quantity
                -
                COALESCE(
                  si.returned_quantity,
                  0
                ),
                0
              )
              /
              si.quantity
            )
          ELSE 0
        END
      ),
      0
    )

  INTO
    v_revenue,
    v_cost

  FROM public.sale_items si

  INNER JOIN public.sales s
    ON s.id = si.sale_id

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND timezone(
    _timezone,
    s.created_at
  )::date
  BETWEEN _from AND _to;


  -- ==========================================================
  -- GASTOS ACTUALES
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(e.amount),
      0
    )

  INTO v_expenses

  FROM public.expenses e

  WHERE (
    _branch_id IS NULL
    OR e.branch_id = _branch_id
  )

  AND e.expense_date
      BETWEEN _from AND _to;


  -- ==========================================================
  -- VENTAS PERIODO ANTERIOR
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(s.total),
      0
    ),
    COUNT(*)::bigint

  INTO
    v_prev_sales,
    v_prev_tickets

  FROM public.sales s

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND timezone(
    _timezone,
    s.created_at
  )::date
  BETWEEN
    v_previous_from
    AND
    v_previous_to;


  -- ==========================================================
  -- COSTO PERIODO ANTERIOR
  -- ==========================================================

  SELECT

    COALESCE(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            si.total
            *
            (
              GREATEST(
                si.quantity
                -
                COALESCE(
                  si.returned_quantity,
                  0
                ),
                0
              )
              /
              si.quantity
            )
          ELSE 0
        END
      ),
      0
    ),

    COALESCE(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            COALESCE(
              si.cost_total,
              0
            )
            *
            (
              GREATEST(
                si.quantity
                -
                COALESCE(
                  si.returned_quantity,
                  0
                ),
                0
              )
              /
              si.quantity
            )
          ELSE 0
        END
      ),
      0
    )

  INTO
    v_prev_revenue,
    v_prev_cost

  FROM public.sale_items si

  INNER JOIN public.sales s
    ON s.id = si.sale_id

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND timezone(
    _timezone,
    s.created_at
  )::date
  BETWEEN
    v_previous_from
    AND
    v_previous_to;


  -- ==========================================================
  -- GASTOS ANTERIORES
  -- ==========================================================

  SELECT
    COALESCE(
      SUM(e.amount),
      0
    )

  INTO v_prev_expenses

  FROM public.expenses e

  WHERE (
    _branch_id IS NULL
    OR e.branch_id = _branch_id
  )

  AND e.expense_date
      BETWEEN
      v_previous_from
      AND
      v_previous_to;


  -- ==========================================================
  -- RESULTADO
  -- ==========================================================

  sales_total :=
    ROUND(
      v_sales_total,
      2
    );

  tickets :=
    v_tickets;

  average_ticket :=
    CASE
      WHEN v_tickets > 0
      THEN ROUND(
        v_sales_total
        /
        v_tickets,
        2
      )
      ELSE 0
    END;


  historical_cost :=
    ROUND(
      v_cost,
      2
    );

  gross_profit :=
    ROUND(
      v_revenue
      -
      v_cost,
      2
    );

  gross_margin :=
    CASE
      WHEN v_revenue > 0
      THEN ROUND(
        (
          (
            v_revenue
            -
            v_cost
          )
          /
          v_revenue
        )
        * 100,
        2
      )
      ELSE 0
    END;


  expenses_total :=
    ROUND(
      v_expenses,
      2
    );

  net_profit :=
    ROUND(
      v_revenue
      -
      v_cost
      -
      v_expenses,
      2
    );


  previous_sales_total :=
    ROUND(
      v_prev_sales,
      2
    );

  previous_tickets :=
    v_prev_tickets;

  previous_average_ticket :=
    CASE
      WHEN v_prev_tickets > 0
      THEN ROUND(
        v_prev_sales
        /
        v_prev_tickets,
        2
      )
      ELSE 0
    END;


  previous_historical_cost :=
    ROUND(
      v_prev_cost,
      2
    );

  previous_gross_profit :=
    ROUND(
      v_prev_revenue
      -
      v_prev_cost,
      2
    );

  previous_gross_margin :=
    CASE
      WHEN v_prev_revenue > 0
      THEN ROUND(
        (
          (
            v_prev_revenue
            -
            v_prev_cost
          )
          /
          v_prev_revenue
        )
        * 100,
        2
      )
      ELSE 0
    END;


  previous_expenses_total :=
    ROUND(
      v_prev_expenses,
      2
    );

  previous_net_profit :=
    ROUND(
      v_prev_revenue
      -
      v_prev_cost
      -
      v_prev_expenses,
      2
    );


  sales_change_percent :=
    CASE
      WHEN v_prev_sales > 0
      THEN ROUND(
        (
          (
            v_sales_total
            -
            v_prev_sales
          )
          /
          v_prev_sales
        )
        * 100,
        2
      )
      ELSE
        CASE
          WHEN v_sales_total > 0
          THEN 100
          ELSE 0
        END
    END;


  profit_change_percent :=
    CASE
      WHEN (
        v_prev_revenue
        -
        v_prev_cost
        -
        v_prev_expenses
      ) <> 0

      THEN ROUND(
        (
          (
            v_revenue
            -
            v_cost
            -
            v_expenses
            -
            (
              v_prev_revenue
              -
              v_prev_cost
              -
              v_prev_expenses
            )
          )
          /
          ABS(
            v_prev_revenue
            -
            v_prev_cost
            -
            v_prev_expenses
          )
        )
        * 100,
        2
      )

      ELSE 0
    END;


  RETURN NEXT;

END;
$$;


-- ============================================================
-- PERMISOS
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_reports_summary(
  date,
  date,
  uuid,
  text
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_reports_summary(
  date,
  date,
  uuid,
  text
)
TO authenticated;


COMMIT;