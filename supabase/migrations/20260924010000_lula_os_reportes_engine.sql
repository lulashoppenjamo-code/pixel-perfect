-- ============================================================
-- LULA OS — MOTOR DE REPORTES EJECUTIVOS
-- ============================================================
-- Fecha: 2026-09-24
--
-- OBJETIVO:
-- 1. Ventas
-- 2. Tickets
-- 3. Ticket promedio
-- 4. Costo histórico
-- 5. Utilidad bruta
-- 6. Margen
-- 7. Gastos
-- 8. Utilidad neta
-- 9. Comparación contra periodo anterior
-- 10. Ventas por día
-- 11. Métodos de pago reales
-- 12. Productos más vendidos
-- 13. Productos menos vendidos
-- 14. Valor del inventario a costo
-- 15. Valor del inventario a precio de venta
-- 16. Productos con bajo inventario
--
-- IMPORTANTE:
-- shared_inventory sigue siendo GLOBAL.
-- branch_id solo filtra operaciones financieras.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. ÍNDICES PARA REPORTES
-- ============================================================

CREATE INDEX IF NOT EXISTS sales_reports_branch_created_idx
ON public.sales (
  branch_id,
  created_at,
  status
);

CREATE INDEX IF NOT EXISTS sale_items_reports_sale_idx
ON public.sale_items (
  sale_id
);

CREATE INDEX IF NOT EXISTS expenses_reports_branch_date_idx
ON public.expenses (
  branch_id,
  expense_date
);

CREATE INDEX IF NOT EXISTS sale_payments_reports_sale_method_idx
ON public.sale_payments (
  sale_id,
  payment_method
);

CREATE INDEX IF NOT EXISTS shared_inventory_reports_product_idx
ON public.shared_inventory (
  product_id,
  variant_id
);


-- ============================================================
-- 2. RESUMEN FINANCIERO
-- ============================================================

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

  v_from date;
  v_to date;

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

  -- ----------------------------------------------------------
  -- VALIDACIÓN
  -- ----------------------------------------------------------

  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF _from IS NULL OR _to IS NULL THEN
    RAISE EXCEPTION 'El periodo es obligatorio';
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'El periodo es inválido';
  END IF;


  -- ----------------------------------------------------------
  -- AUTORIZACIÓN DE SUCURSAL
  -- ----------------------------------------------------------

  IF _branch_id IS NOT NULL
     AND NOT public.is_manager(uid)
  THEN

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = uid
        AND p.branch_id = _branch_id
        AND COALESCE(p.is_active, false) = true
    ) THEN
      RAISE EXCEPTION 'No tienes acceso a esta sucursal';
    END IF;

  END IF;


  -- ----------------------------------------------------------
  -- PERIODOS
  -- ----------------------------------------------------------

  v_from := _from;
  v_to := _to;

  v_period_days :=
    (_to - _from) + 1;

  v_previous_to := _from - 1;
  v_previous_from :=
    v_previous_to - v_period_days + 1;


  -- ==========================================================
  -- PERIODO ACTUAL
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
  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  ) BETWEEN v_from AND v_to;


  -- ----------------------------------------------------------
  -- INGRESO NETO DE PRODUCTOS Y COSTO HISTÓRICO
  --
  -- Se descuenta la cantidad devuelta.
  -- ----------------------------------------------------------

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
                - COALESCE(si.returned_quantity, 0),
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
            COALESCE(si.cost_total, 0)
            *
            (
              GREATEST(
                si.quantity
                - COALESCE(si.returned_quantity, 0),
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

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  ) BETWEEN v_from AND v_to;


  -- ----------------------------------------------------------
  -- GASTOS
  -- ----------------------------------------------------------

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
      BETWEEN v_from AND v_to;


  -- ==========================================================
  -- PERIODO ANTERIOR
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

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  )
  BETWEEN
    v_previous_from
    AND
    v_previous_to;


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
                - COALESCE(si.returned_quantity, 0),
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
            COALESCE(si.cost_total, 0)
            *
            (
              GREATEST(
                si.quantity
                - COALESCE(si.returned_quantity, 0),
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

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  )
  BETWEEN
    v_previous_from
    AND
    v_previous_to;


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
        v_sales_total / v_tickets,
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
      v_revenue - v_cost,
      2
    );

  gross_margin :=
    CASE
      WHEN v_revenue > 0
      THEN ROUND(
        (
          (v_revenue - v_cost)
          /
          v_revenue
        ) * 100,
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
      (v_revenue - v_cost)
      - v_expenses,
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
        v_prev_sales / v_prev_tickets,
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
      v_prev_revenue - v_prev_cost,
      2
    );

  previous_gross_margin :=
    CASE
      WHEN v_prev_revenue > 0
      THEN ROUND(
        (
          (v_prev_revenue - v_prev_cost)
          /
          v_prev_revenue
        ) * 100,
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
      (
        v_prev_revenue
        - v_prev_cost
      )
      - v_prev_expenses,
      2
    );


  sales_change_percent :=
    CASE
      WHEN v_prev_sales > 0
      THEN ROUND(
        (
          (
            v_sales_total
            - v_prev_sales
          )
          /
          v_prev_sales
        ) * 100,
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
        - v_prev_cost
        - v_prev_expenses
      ) <> 0

      THEN ROUND(
        (
          (
            (
              v_revenue
              - v_cost
              - v_expenses
            )
            -
            (
              v_prev_revenue
              - v_prev_cost
              - v_prev_expenses
            )
          )
          /
          ABS(
            v_prev_revenue
            - v_prev_cost
            - v_prev_expenses
          )
        ) * 100,
        2
      )

      ELSE 0
    END;


  RETURN NEXT;

END;
$$;


-- ============================================================
-- 3. VENTAS POR DÍA
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_reports_daily_sales(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL,
  _timezone text DEFAULT 'America/Mexico_City'
)
RETURNS TABLE (
  day date,
  sales_total numeric,
  tickets bigint,
  average_ticket numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT
    timezone(
      _timezone,
      s.created_at
    )::date AS day,

    ROUND(
      COALESCE(
        SUM(s.total),
        0
      ),
      2
    ) AS sales_total,

    COUNT(*)::bigint AS tickets,

    CASE
      WHEN COUNT(*) > 0
      THEN ROUND(
        SUM(s.total)
        /
        COUNT(*),
        2
      )
      ELSE 0
    END AS average_ticket

  FROM public.sales s

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  )
  BETWEEN _from AND _to

  GROUP BY
    timezone(
      _timezone,
      s.created_at
    )::date

  ORDER BY day;

$$;


-- ============================================================
-- 4. MÉTODOS DE PAGO REALES
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_reports_payment_methods(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL,
  _timezone text DEFAULT 'America/Mexico_City'
)
RETURNS TABLE (
  payment_method text,
  total numeric,
  transactions bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT
    sp.payment_method::text,

    ROUND(
      COALESCE(
        SUM(sp.amount),
        0
      ),
      2
    ) AS total,

    COUNT(*)::bigint AS transactions

  FROM public.sale_payments sp

  INNER JOIN public.sales s
    ON s.id = sp.sale_id

  WHERE s.status IN (
    'completed'::public.sale_status,
    'partially_refunded'::public.sale_status
  )

  AND (
    _branch_id IS NULL
    OR s.branch_id = _branch_id
  )

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  )
  BETWEEN _from AND _to

  GROUP BY
    sp.payment_method

  ORDER BY
    total DESC;

$$;


-- ============================================================
-- 5. PRODUCTOS MÁS / MENOS VENDIDOS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_reports_product_performance(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL,
  _limit integer DEFAULT 50,
  _timezone text DEFAULT 'America/Mexico_City'
)
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  product_name text,
  quantity numeric,
  revenue numeric,
  historical_cost numeric,
  gross_profit numeric,
  gross_margin numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT

    si.product_id,

    si.variant_id,

    MAX(
      si.name_snapshot
    )::text AS product_name,

    ROUND(
      SUM(
        GREATEST(
          si.quantity
          - COALESCE(
              si.returned_quantity,
              0
            ),
          0
        )
      ),
      2
    ) AS quantity,

    ROUND(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            si.total
            *
            (
              GREATEST(
                si.quantity
                - COALESCE(
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
      2
    ) AS revenue,

    ROUND(
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
                - COALESCE(
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
      2
    ) AS historical_cost,

    ROUND(
      SUM(
        CASE
          WHEN si.quantity > 0
          THEN
            (
              si.total
              -
              COALESCE(
                si.cost_total,
                0
              )
            )
            *
            (
              GREATEST(
                si.quantity
                - COALESCE(
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
      2
    ) AS gross_profit,

    CASE
      WHEN
        SUM(
          CASE
            WHEN si.quantity > 0
            THEN
              si.total
              *
              (
                GREATEST(
                  si.quantity
                  - COALESCE(
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
        ) > 0

      THEN ROUND(
        (
          SUM(
            CASE
              WHEN si.quantity > 0
              THEN
                (
                  si.total
                  -
                  COALESCE(
                    si.cost_total,
                    0
                  )
                )
                *
                (
                  GREATEST(
                    si.quantity
                    - COALESCE(
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
          )
          /
          SUM(
            CASE
              WHEN si.quantity > 0
              THEN
                si.total
                *
                (
                  GREATEST(
                    si.quantity
                    - COALESCE(
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
          )
        ) * 100,
        2
      )

      ELSE 0
    END AS gross_margin

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

  AND (
    timezone(
      _timezone,
      s.created_at
    )::date
  )
  BETWEEN _from AND _to

  GROUP BY
    si.product_id,
    si.variant_id

  ORDER BY
    revenue DESC

  LIMIT GREATEST(
    COALESCE(_limit, 50),
    1
  );

$$;


-- ============================================================
-- 6. INVENTARIO EJECUTIVO
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_reports_inventory()
RETURNS TABLE (
  product_id uuid,
  variant_id uuid,
  product_name text,
  sku text,
  barcode text,

  stock numeric,
  reserved_stock numeric,
  available_stock numeric,

  min_stock numeric,
  max_stock numeric,

  unit_cost numeric,
  unit_price numeric,

  inventory_cost numeric,
  inventory_retail numeric,

  stock_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$

  SELECT

    si.product_id,

    si.variant_id,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN
        COALESCE(
          pv.name,
          p.name
        )
      ELSE
        p.name
    END::text AS product_name,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN
        COALESCE(
          pv.sku,
          p.sku
        )
      ELSE
        p.sku
    END::text AS sku,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN
        COALESCE(
          pv.barcode,
          p.barcode
        )
      ELSE
        p.barcode
    END::text AS barcode,

    COALESCE(
      si.stock,
      0
    ) AS stock,

    COALESCE(
      si.reserved_stock,
      0
    ) AS reserved_stock,

    GREATEST(
      COALESCE(si.stock, 0)
      -
      COALESCE(
        si.reserved_stock,
        0
      ),
      0
    ) AS available_stock,

    COALESCE(
      si.min_stock,
      0
    ) AS min_stock,

    si.max_stock,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN
        COALESCE(
          pv.cost_override,
          p.cost,
          0
        )
      ELSE
        COALESCE(
          p.cost,
          0
        )
    END AS unit_cost,

    CASE
      WHEN si.variant_id IS NOT NULL
      THEN
        COALESCE(
          pv.price_override,
          p.price,
          0
        )
      ELSE
        COALESCE(
          p.price,
          0
        )
    END AS unit_price,

    ROUND(
      COALESCE(si.stock, 0)
      *
      CASE
        WHEN si.variant_id IS NOT NULL
        THEN
          COALESCE(
            pv.cost_override,
            p.cost,
            0
          )
        ELSE
          COALESCE(
            p.cost,
            0
          )
      END,
      2
    ) AS inventory_cost,

    ROUND(
      COALESCE(si.stock, 0)
      *
      CASE
        WHEN si.variant_id IS NOT NULL
        THEN
          COALESCE(
            pv.price_override,
            p.price,
            0
          )
        ELSE
          COALESCE(
            p.price,
            0
          )
      END,
      2
    ) AS inventory_retail,

    CASE
      WHEN
        GREATEST(
          COALESCE(si.stock, 0)
          -
          COALESCE(
            si.reserved_stock,
            0
          ),
          0
        ) <= 0
      THEN 'out_of_stock'

      WHEN
        GREATEST(
          COALESCE(si.stock, 0)
          -
          COALESCE(
            si.reserved_stock,
            0
          ),
          0
        ) <= COALESCE(
          si.min_stock,
          0
        )
      THEN 'low_stock'

      ELSE 'ok'
    END AS stock_status

  FROM public.shared_inventory si

  INNER JOIN public.products p
    ON p.id = si.product_id

  LEFT JOIN public.product_variants pv
    ON pv.id = si.variant_id

  WHERE p.is_active = true

  ORDER BY
    available_stock ASC,
    product_name ASC;

$$;


-- ============================================================
-- 7. SEGURIDAD
-- ============================================================

REVOKE ALL
ON FUNCTION public.get_reports_summary(
  date,
  date,
  uuid,
  text
)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_reports_daily_sales(
  date,
  date,
  uuid,
  text
)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_reports_payment_methods(
  date,
  date,
  uuid,
  text
)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_reports_product_performance(
  date,
  date,
  uuid,
  integer,
  text
)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_reports_inventory()
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.get_reports_summary(
  date,
  date,
  uuid,
  text
)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_reports_daily_sales(
  date,
  date,
  uuid,
  text
)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_reports_payment_methods(
  date,
  date,
  uuid,
  text
)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_reports_product_performance(
  date,
  date,
  uuid,
  integer,
  text
)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_reports_inventory()
TO authenticated;


-- ============================================================
-- 8. DOCUMENTACIÓN
-- ============================================================

COMMENT ON FUNCTION public.get_reports_summary(
  date,
  date,
  uuid,
  text
)
IS
'LULA OS: resumen financiero ejecutivo con ventas, tickets, costo histórico, utilidad, gastos y comparación contra periodo anterior.';

COMMENT ON FUNCTION public.get_reports_daily_sales(
  date,
  date,
  uuid,
  text
)
IS
'LULA OS: ventas y tickets agrupados por día.';

COMMENT ON FUNCTION public.get_reports_payment_methods(
  date,
  date,
  uuid,
  text
)
IS
'LULA OS: distribución real de pagos basada en sale_payments.';

COMMENT ON FUNCTION public.get_reports_product_performance(
  date,
  date,
  uuid,
  integer,
  text
)
IS
'LULA OS: rendimiento histórico de productos considerando devoluciones.';

COMMENT ON FUNCTION public.get_reports_inventory()
IS
'LULA OS: inventario compartido ejecutivo con valores a costo, venta y alertas de stock.';


COMMIT;