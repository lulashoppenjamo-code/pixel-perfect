import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { subDays, parseISO, format } from "date-fns";
import {
  TrendingDown,
  TrendingUp,
  DollarSign,
  Receipt,
  Package,
  BarChart3,
  Boxes,
  AlertTriangle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/reportes")({
  head: () => ({
    meta: [
      {
        title: "Reportes — Lula OS",
      },
      {
        name: "description",
        content:
          "Reportes ejecutivos de ventas, utilidad, costos históricos e inventario compartido.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="reportes">
      <ReportesPage />
    </RequireNavAccess>
  ),
});

/*
 * ============================================================
 * CONFIGURACIÓN
 * ============================================================
 */

const RANGES = [
  {
    value: "7",
    label: "Últimos 7 días",
  },
  {
    value: "30",
    label: "Últimos 30 días",
  },
  {
    value: "90",
    label: "Últimos 90 días",
  },
] as const;

const REPORT_TIMEZONE = "America/Mexico_City";

/*
 * ============================================================
 * TIPOS
 * ============================================================
 */

type ReportSummary = {
  sales_total: number;
  tickets: number;
  average_ticket: number;

  historical_cost: number;
  gross_profit: number;
  gross_margin: number;

  expenses_total: number;
  net_profit: number;

  previous_sales_total: number;
  previous_tickets: number;
  previous_average_ticket: number;

  previous_historical_cost: number;
  previous_gross_profit: number;
  previous_gross_margin: number;

  previous_expenses_total: number;
  previous_net_profit: number;

  sales_change_percent: number;
  profit_change_percent: number;
};

type DailySales = {
  day: string;
  sales_total: number;
  tickets: number;
  average_ticket: number;
};

type PaymentMethodRow = {
  payment_method: string;
  total: number;
  transactions: number;
};

type ProductPerformance = {
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  quantity: number;
  revenue: number;
  historical_cost: number;
  gross_profit: number;
  gross_margin: number;
};

type InventoryReportRow = {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;

  stock: number;
  reserved_stock: number;
  available_stock: number;

  min_stock: number;
  max_stock: number | null;

  unit_cost: number;
  unit_price: number;

  inventory_cost: number;
  inventory_retail: number;

  stock_status: string;
};

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

/**
 * Supabase ya tiene las RPC nuevas en la base de datos.
 *
 * El archivo types.ts generado todavía no contiene esas RPC,
 * por lo que aquí aislamos temporalmente el cast.
 *
 * Después podremos regenerar types.ts desde Supabase.
 */
const rpc = supabase.rpc as any;

function getMexicoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

const paymentLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Crédito",
  mixed: "Mixto",
};

/*
 * ============================================================
 * PÁGINA
 * ============================================================
 */

function ReportesPage() {
  const { branchId } = useBranch();

  const [rangeDays, setRangeDays] = useState("30");

  const days = Number(rangeDays);

  /*
   * ----------------------------------------------------------
   * FECHAS
   * ----------------------------------------------------------
   *
   * Usamos fechas locales de México.
   *
   * Ejemplo:
   * Últimos 30 días =
   * hoy + 29 días anteriores.
   */

  const toDate = useMemo(
    () => getMexicoDate(),
    [],
  );

  const fromDate = useMemo(() => {
    const date = parseISO(toDate);

    return format(
      subDays(date, days - 1),
      "yyyy-MM-dd",
    );
  }, [toDate, days]);

  /*
   * ----------------------------------------------------------
   * RESUMEN EJECUTIVO
   * ----------------------------------------------------------
   */

  const {
    data: summary,
    isLoading: loadingSummary,
    error: summaryError,
  } = useQuery<ReportSummary>({
    queryKey: [
      "reports",
      "summary",
      branchId,
      fromDate,
      toDate,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_summary",
        {
          _from: fromDate,
          _to: toDate,
          _branch_id: branchId,
          _timezone: REPORT_TIMEZONE,
        },
      );

      if (error) {
        throw error;
      }

      const row = Array.isArray(data)
        ? data[0]
        : data;

      if (!row) {
        throw new Error(
          "El reporte no devolvió información.",
        );
      }

      return {
        sales_total: Number(row.sales_total ?? 0),
        tickets: Number(row.tickets ?? 0),
        average_ticket: Number(
          row.average_ticket ?? 0,
        ),

        historical_cost: Number(
          row.historical_cost ?? 0,
        ),
        gross_profit: Number(
          row.gross_profit ?? 0,
        ),
        gross_margin: Number(
          row.gross_margin ?? 0,
        ),

        expenses_total: Number(
          row.expenses_total ?? 0,
        ),
        net_profit: Number(
          row.net_profit ?? 0,
        ),

        previous_sales_total: Number(
          row.previous_sales_total ?? 0,
        ),
        previous_tickets: Number(
          row.previous_tickets ?? 0,
        ),
        previous_average_ticket: Number(
          row.previous_average_ticket ?? 0,
        ),

        previous_historical_cost: Number(
          row.previous_historical_cost ?? 0,
        ),
        previous_gross_profit: Number(
          row.previous_gross_profit ?? 0,
        ),
        previous_gross_margin: Number(
          row.previous_gross_margin ?? 0,
        ),

        previous_expenses_total: Number(
          row.previous_expenses_total ?? 0,
        ),
        previous_net_profit: Number(
          row.previous_net_profit ?? 0,
        ),

        sales_change_percent: Number(
          row.sales_change_percent ?? 0,
        ),
        profit_change_percent: Number(
          row.profit_change_percent ?? 0,
        ),
      };
    },
  });

  /*
   * ----------------------------------------------------------
   * VENTAS POR DÍA
   * ----------------------------------------------------------
   */

  const {
    data: dailySales = [],
    isLoading: loadingDaily,
  } = useQuery<DailySales[]>({
    queryKey: [
      "reports",
      "daily-sales",
      branchId,
      fromDate,
      toDate,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_daily_sales",
        {
          _from: fromDate,
          _to: toDate,
          _branch_id: branchId,
          _timezone: REPORT_TIMEZONE,
        },
      );

      if (error) {
        throw error;
      }

      return (data ?? []).map(
        (row: any) => ({
          day: String(row.day),
          sales_total: Number(
            row.sales_total ?? 0,
          ),
          tickets: Number(
            row.tickets ?? 0,
          ),
          average_ticket: Number(
            row.average_ticket ?? 0,
          ),
        }),
      );
    },
  });

  /*
   * ----------------------------------------------------------
   * MÉTODOS DE PAGO
   * ----------------------------------------------------------
   */

  const {
    data: paymentMethods = [],
    isLoading: loadingPayments,
  } = useQuery<PaymentMethodRow[]>({
    queryKey: [
      "reports",
      "payments",
      branchId,
      fromDate,
      toDate,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_payment_methods",
        {
          _from: fromDate,
          _to: toDate,
          _branch_id: branchId,
          _timezone: REPORT_TIMEZONE,
        },
      );

      if (error) {
        throw error;
      }

      return (data ?? []).map(
        (row: any) => ({
          payment_method:
            String(
              row.payment_method ??
                "cash",
            ),
          total: Number(
            row.total ?? 0,
          ),
          transactions: Number(
            row.transactions ?? 0,
          ),
        }),
      );
    },
  });

  /*
   * ----------------------------------------------------------
   * PRODUCTOS
   * ----------------------------------------------------------
   */

  const {
    data: products = [],
    isLoading: loadingProducts,
  } = useQuery<ProductPerformance[]>({
    queryKey: [
      "reports",
      "products",
      branchId,
      fromDate,
      toDate,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_product_performance",
        {
          _from: fromDate,
          _to: toDate,
          _branch_id: branchId,
          _limit: 50,
          _timezone: REPORT_TIMEZONE,
        },
      );

      if (error) {
        throw error;
      }

      return (data ?? []).map(
        (row: any) => ({
          product_id:
            row.product_id ?? null,

          variant_id:
            row.variant_id ?? null,

          product_name:
            String(
              row.product_name ??
                "Producto sin nombre",
            ),

          quantity: Number(
            row.quantity ?? 0,
          ),

          revenue: Number(
            row.revenue ?? 0,
          ),

          historical_cost: Number(
            row.historical_cost ?? 0,
          ),

          gross_profit: Number(
            row.gross_profit ?? 0,
          ),

          gross_margin: Number(
            row.gross_margin ?? 0,
          ),
        }),
      );
    },
  });

  /*
   * ----------------------------------------------------------
   * INVENTARIO GLOBAL
   * ----------------------------------------------------------
   *
   * IMPORTANTE:
   *
   * NO usamos branch_id.
   *
   * El inventario de Lula Shop es compartido
   * entre las dos tiendas.
   */

  const {
    data: inventory = [],
    isLoading: loadingInventory,
  } = useQuery<InventoryReportRow[]>({
    queryKey: [
      "reports",
      "inventory",
    ],

    queryFn: async () => {
      const { data, error } = await rpc(
        "get_reports_inventory",
      );

      if (error) {
        throw error;
      }

      return (data ?? []).map(
        (row: any) => ({
          product_id:
            String(row.product_id),

          variant_id:
            row.variant_id ?? null,

          product_name:
            String(
              row.product_name ??
                "Producto sin nombre",
            ),

          sku:
            row.sku ?? null,

          barcode:
            row.barcode ?? null,

          stock: Number(
            row.stock ?? 0,
          ),

          reserved_stock: Number(
            row.reserved_stock ?? 0,
          ),

          available_stock: Number(
            row.available_stock ?? 0,
          ),

          min_stock: Number(
            row.min_stock ?? 0,
          ),

          max_stock:
            row.max_stock === null ||
            row.max_stock === undefined
              ? null
              : Number(
                  row.max_stock,
                ),

          unit_cost: Number(
            row.unit_cost ?? 0,
          ),

          unit_price: Number(
            row.unit_price ?? 0,
          ),

          inventory_cost: Number(
            row.inventory_cost ?? 0,
          ),

          inventory_retail: Number(
            row.inventory_retail ?? 0,
          ),

          stock_status:
            String(
              row.stock_status ??
                "ok",
            ),
        }),
      );
    },
  });

  /*
   * ============================================================
   * DATOS CALCULADOS DE PRESENTACIÓN
   * ============================================================
   */

  const salesChart = useMemo(
    () =>
      dailySales.map(
        (row) => ({
          day: row.day,
          label: format(
            parseISO(row.day),
            "dd/MM",
          ),
          total: roundMoney(
            row.sales_total,
          ),
        }),
      ),
    [dailySales],
  );

  const lowStock = useMemo(
    () =>
      inventory
        .filter(
          (item) =>
            item.stock_status ===
              "low_stock" ||
            item.stock_status ===
              "out_of_stock",
        )
        .sort(
          (a, b) =>
            a.available_stock -
            b.available_stock,
        )
        .slice(0, 30),
    [inventory],
  );

  const inventoryUnits = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          item.stock,
        0,
      ),
    [inventory],
  );

  const inventoryReserved = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          item.reserved_stock,
        0,
      ),
    [inventory],
  );

  const inventoryAvailable = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          item.available_stock,
        0,
      ),
    [inventory],
  );

  const inventoryCost = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          item.inventory_cost,
        0,
      ),
    [inventory],
  );

  const inventoryRetail = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          item.inventory_retail,
        0,
      ),
    [inventory],
  );

  const inventoryPotentialProfit =
    inventoryRetail -
    inventoryCost;

  /*
   * ============================================================
   * ERRORES
   * ============================================================
   */

  if (summaryError) {
    return (
      <PageShell>
        <PageHeader
          icon={BarChart3}
          title="Reportes"
          description="Ventas, utilidad, costos históricos e inventario compartido."
        />

        <Card className="border-destructive/30">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="font-semibold text-destructive">
                No se pudieron cargar
                los reportes.
              </p>

              <p className="text-sm text-muted-foreground">
                {summaryError instanceof
                Error
                  ? summaryError.message
                  : "Error desconocido"}
              </p>

              <p className="text-xs text-muted-foreground">
                Revisa que la migración
                20260924010000_lula_os_reportes_engine.sql
                esté aplicada en Supabase.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <PageShell className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Reportes"
        description="Ventas, utilidad real, costos históricos e inventario compartido."
        action={
          <Select
            value={rangeDays}
            onValueChange={setRangeDays}
          >
            <SelectTrigger className="w-[180px] rounded-xl">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {RANGES.map(
                (range) => (
                  <SelectItem
                    key={range.value}
                    value={range.value}
                  >
                    {range.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        }
      />

      {/* ======================================================
          PERIODO
      ======================================================= */}

      <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Periodo:
        <span className="ml-1 font-medium text-foreground">
          {fromDate}
        </span>
        <span className="mx-1">
          →
        </span>
        <span className="font-medium text-foreground">
          {toDate}
        </span>
      </div>

      {/* ======================================================
          KPIs FINANCIEROS
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Ventas"
          value={money(
            summary?.sales_total ?? 0,
          )}
          icon={DollarSign}
          delta={
            summary?.sales_change_percent
          }
          loading={
            loadingSummary
          }
          subtitle={
            summary
              ? `${summary.tickets.toLocaleString(
                  "es-MX",
                )} ventas`
              : undefined
          }
        />

        <KpiCard
          title="Ticket promedio"
          value={money(
            summary?.average_ticket ??
              0,
          )}
          icon={Receipt}
          loading={
            loadingSummary
          }
          subtitle={
            summary
              ? `Anterior ${money(
                  summary.previous_average_ticket,
                )}`
              : undefined
          }
        />

        <KpiCard
          title="Utilidad bruta"
          value={money(
            summary?.gross_profit ??
              0,
          )}
          icon={TrendingUp}
          loading={
            loadingSummary
          }
          subtitle={
            summary
              ? `Margen ${summary.gross_margin.toFixed(
                  1,
                )}%`
              : undefined
          }
        />

        <KpiCard
          title="Utilidad neta"
          value={money(
            summary?.net_profit ?? 0,
          )}
          icon={
            (summary?.net_profit ?? 0) >=
            0
              ? TrendingUp
              : TrendingDown
          }
          loading={
            loadingSummary
          }
          subtitle={
            summary
              ? `Gastos ${money(
                  summary.expenses_total,
                )}`
              : undefined
          }
        />
      </div>

      {/* ======================================================
          KPIs INVENTARIO
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Unidades"
          value={inventoryUnits.toLocaleString(
            "es-MX",
          )}
          icon={Boxes}
          loading={
            loadingInventory
          }
        />

        <KpiCard
          title="Disponibles"
          value={inventoryAvailable.toLocaleString(
            "es-MX",
          )}
          icon={Package}
          loading={
            loadingInventory
          }
          subtitle={`${inventoryReserved.toLocaleString(
            "es-MX",
          )} reservadas`}
        />

        <KpiCard
          title="Inventario a costo"
          value={money(
            inventoryCost,
          )}
          icon={DollarSign}
          loading={
            loadingInventory
          }
        />

        <KpiCard
          title="Inventario a venta"
          value={money(
            inventoryRetail,
          )}
          icon={TrendingUp}
          loading={
            loadingInventory
          }
          subtitle={`Utilidad potencial ${money(
            inventoryPotentialProfit,
          )}`}
        />
      </div>

      {/* ======================================================
          GRÁFICA DE VENTAS
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Ventas por día
          </CardTitle>
        </CardHeader>

        <CardContent>
          {loadingDaily ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Cargando ventas...
            </div>
          ) : salesChart.length ===
            0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin ventas en el periodo.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <BarChart
                  data={salesChart}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />

                  <XAxis
                    dataKey="label"
                    tick={{
                      fontSize: 11,
                    }}
                  />

                  <YAxis
                    tick={{
                      fontSize: 11,
                    }}
                    width={65}
                  />

                  <Tooltip
                    formatter={(
                      value: number,
                    ) => [
                      money(
                        Number(value),
                      ),
                      "Ventas",
                    ]}
                    contentStyle={{
                      borderRadius: 8,
                    }}
                  />

                  <Bar
                    dataKey="total"
                    fill="hsl(var(--primary))"
                    radius={[
                      4,
                      4,
                      0,
                      0,
                    ]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          RESUMEN FINANCIERO
      ======================================================= */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Resumen financiero
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <SummaryRow
              label="Ventas"
              value={money(
                summary?.sales_total ??
                  0,
              )}
            />

            <SummaryRow
              label="Costo histórico de mercancía"
              value={money(
                summary?.historical_cost ??
                  0,
              )}
            />

            <SummaryRow
              label="Utilidad bruta"
              value={money(
                summary?.gross_profit ??
                  0,
              )}
              strong
            />

            <SummaryRow
              label="Margen bruto"
              value={`${(
                summary?.gross_margin ??
                0
              ).toFixed(2)}%`}
            />

            <SummaryRow
              label="Gastos"
              value={money(
                summary?.expenses_total ??
                  0,
              )}
            />

            <div className="border-t pt-3">
              <SummaryRow
                label="Utilidad neta"
                value={money(
                  summary?.net_profit ??
                    0,
                )}
                strong
              />
            </div>
          </CardContent>
        </Card>

        {/* ====================================================
            COMPARATIVO
        ===================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Comparación contra periodo anterior
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <ComparisonRow
              label="Ventas"
              current={
                summary?.sales_total ??
                0
              }
              previous={
                summary?.previous_sales_total ??
                0
              }
              percent={
                summary?.sales_change_percent ??
                0
            }
            />

            <ComparisonRow
              label="Utilidad neta"
              current={
                summary?.net_profit ??
                0
              }
              previous={
                summary?.previous_net_profit ??
                0
              }
              percent={
                summary?.profit_change_percent ??
                0
              }
            />

            <ComparisonRow
              label="Ticket promedio"
              current={
                summary?.average_ticket ??
                0
              }
              previous={
                summary?.previous_average_ticket ??
                0
              }
            />

            <ComparisonRow
              label="Gastos"
              current={
                summary?.expenses_total ??
                0
              }
              previous={
                summary?.previous_expenses_total ??
                0
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* ======================================================
          MÉTODOS DE PAGO
      ======================================================= */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Métodos de pago
          </CardTitle>
        </CardHeader>

        <CardContent>
          {loadingPayments ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Cargando pagos...
            </p>
          ) : paymentMethods.length ===
            0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin pagos en el periodo.
            </p>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map(
                (payment) => {
                  const label =
                    paymentLabels[
                      payment.payment_method
                    ] ??
                    payment.payment_method;

                  return (
                    <div
                      key={
                        payment.payment_method
                      }
                      className="flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {label}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {payment.transactions.toLocaleString(
                            "es-MX",
                          )}{" "}
                          operaciones
                        </p>
                      </div>

                      <span className="font-semibold">
                        {money(
                          payment.total,
                        )}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          PRODUCTOS
      ======================================================= */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Productos más vendidos
          </CardTitle>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {loadingProducts ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Cargando productos...
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    #
                  </TableHead>

                  <TableHead>
                    Producto
                  </TableHead>

                  <TableHead className="text-right">
                    Cantidad
                  </TableHead>

                  <TableHead className="text-right">
                    Ventas
                  </TableHead>

                  <TableHead className="text-right">
                    Costo
                  </TableHead>

                  <TableHead className="text-right">
                    Utilidad
                  </TableHead>

                  <TableHead className="text-right">
                    Margen
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {products
                  .slice(0, 15)
                  .map(
                    (
                      product,
                      index,
                    ) => (
                      <TableRow
                        key={`${product.product_id ?? "snapshot"}-${product.variant_id ?? "base"}-${index}`}
                      >
                        <TableCell className="text-muted-foreground">
                          {index + 1}
                        </TableCell>

                        <TableCell className="font-medium">
                          {
                            product.product_name
                          }
                        </TableCell>

                        <TableCell className="text-right">
                          {product.quantity.toLocaleString(
                            "es-MX",
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          {money(
                            product.revenue,
                          )}
                        </TableCell>

                        <TableCell className="text-right text-muted-foreground">
                          {money(
                            product.historical_cost,
                          )}
                        </TableCell>

                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            product.gross_profit >=
                              0
                              ? "text-emerald-600"
                              : "text-destructive",
                          )}
                        >
                          {money(
                            product.gross_profit,
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          {product.gross_margin.toFixed(
                            1,
                          )}
                          %
                        </TableCell>
                      </TableRow>
                    ),
                  )}

                {!products.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Sin datos de
                      productos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          INVENTARIO BAJO
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Productos bajo mínimo
          </CardTitle>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {loadingInventory ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Cargando inventario...
            </p>
          ) : lowStock.length ===
            0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay productos bajo mínimo.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    Producto
                  </TableHead>

                  <TableHead>
                    SKU
                  </TableHead>

                  <TableHead className="text-right">
                    Disponible
                  </TableHead>

                  <TableHead className="text-right">
                    Mínimo
                  </TableHead>

                  <TableHead className="text-right">
                    Costo
                  </TableHead>

                  <TableHead className="text-right">
                    Valor venta
                  </TableHead>

                  <TableHead className="text-right">
                    Estado
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {lowStock.map(
                  (item) => (
                    <TableRow
                      key={`${item.product_id}-${item.variant_id ?? "base"}`}
                    >
                      <TableCell className="font-medium">
                        {
                          item.product_name
                        }
                      </TableCell>

                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.sku ??
                          "—"}
                      </TableCell>

                      <TableCell className="text-right font-semibold">
                        {item.available_stock.toLocaleString(
                          "es-MX",
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {item.min_stock.toLocaleString(
                          "es-MX",
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {money(
                          item.inventory_cost,
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {money(
                          item.inventory_retail,
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {item.stock_status ===
                        "out_of_stock" ? (
                          <Badge variant="destructive">
                            Agotado
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            Bajo
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

/*
 * ============================================================
 * COMPONENTE KPI
 * ============================================================
 */

function KpiCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  loading,
}: {
  title: string;
  value: string;
  icon: typeof DollarSign;
  delta?: number;
  subtitle?: string;
  loading?: boolean;
}) {
  const safeDelta =
    Number(delta ?? 0);

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {title}
            </p>

            <p className="mt-1 text-2xl font-bold tracking-tight">
              {loading
                ? "…"
                : value}
            </p>

            {delta !==
              undefined &&
              !loading && (
                <p
                  className={cn(
                    "mt-1 flex items-center gap-1 text-xs font-medium",
                    safeDelta >=
                      0
                      ? "text-emerald-600"
                      : "text-destructive",
                  )}
                >
                  {safeDelta >=
                  0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}

                  {safeDelta >=
                  0
                    ? "+"
                    : ""}
                  {safeDelta.toFixed(
                    1,
                  )}
                  % vs periodo anterior
                </p>
              )}

            {subtitle &&
              !loading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {subtitle}
                </p>
              )}
          </div>

          <div className="shrink-0 rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/*
 * ============================================================
 * FILA DE RESUMEN
 * ============================================================
 */

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        strong &&
          "font-semibold",
      )}
    >
      <span>{label}</span>

      <span className="text-right">
        {value}
      </span>
    </div>
  );
}

/*
 * ============================================================
 * FILA DE COMPARACIÓN
 * ============================================================
 */

function ComparisonRow({
  label,
  current,
  previous,
  percent,
}: {
  label: string;
  current: number;
  previous: number;
  percent?: number;
}) {
  const difference =
    current - previous;

  const change =
    percent !== undefined
      ? percent
      : previous !== 0
        ? (difference /
            Math.abs(
              previous,
            )) *
          100
        : current !== 0
          ? 100
          : 0;

  return (
    <div className="flex items-center justify-between gap-4 border-b last:border-0 pb-3 last:pb-0">
      <div>
        <p className="text-sm font-medium">
          {label}
        </p>

        <p className="text-xs text-muted-foreground">
          Anterior:{" "}
          {money(previous)}
        </p>
      </div>

      <div className="text-right">
        <p className="font-semibold">
          {money(current)}
        </p>

        <p
          className={cn(
            "text-xs font-medium",
            change >= 0
              ? "text-emerald-600"
              : "text-destructive",
          )}
        >
          {change >= 0
            ? "+"
            : ""}
          {change.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}