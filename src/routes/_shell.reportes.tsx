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
import {
  subDays,
  format,
  parseISO,
  startOfDay,
} from "date-fns";
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
import { getSharedInventory } from "@/lib/sharedInventory";

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
import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";
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
          "Reportes de ventas, utilidad, costos históricos, inventario compartido y productos.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="reportes">
      <ReportesPage />
    </RequireNavAccess>
  ),
});

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
];

type SaleRow = {
  id: string;
  total: number;
  subtotal: number;
  tax: number;
  discount: number;
  created_at: string;
  status: string;
  payment_method: string;
  cashier_id: string;
};

type SaleItemRow = {
  sale_id: string;
  name_snapshot: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  product_id: string | null;
  variant_id: string | null;
  unit_cost: number | null;
  cost_total: number | null;
};

type InventoryRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  stock: number;
  reserved_stock: number;
  available_stock: number;
  min_stock: number;
  max_stock: number | null;
  stock_status: string;
};

function ReportesPage() {
  const { branchId } = useBranch();

  const [rangeDays, setRangeDays] = useState("30");

  const days = Number(rangeDays);

  /*
   * ============================================================
   * PERIODOS
   * ============================================================
   *
   * Antes:
   *
   * 30 días = desde hoy - 30 días
   *
   * Eso realmente incluía 31 fechas de calendario.
   *
   * Ahora:
   *
   * 30 días = hoy + 29 días anteriores.
   *
   * El periodo anterior tiene exactamente la misma cantidad
   * de días.
   */

  const since = useMemo(
    () =>
      startOfDay(
        subDays(
          new Date(),
          Math.max(days - 1, 0),
        ),
      ).toISOString(),
    [days],
  );

  const prevSince = useMemo(
    () =>
      startOfDay(
        subDays(
          new Date(),
          Math.max(days * 2 - 1, 0),
        ),
      ).toISOString(),
    [days],
  );

  const prevUntil = since;

  const todayDate = useMemo(
    () =>
      format(
        new Date(),
        "yyyy-MM-dd",
      ),
    [],
  );

  /*
   * ============================================================
   * VENTAS ACTUALES
   * ============================================================
   */

  const {
    data: sales = [],
    isLoading: loadingSales,
    error: salesError,
  } = useQuery({
    queryKey: [
      "report-sales",
      branchId,
      rangeDays,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("sales")
        .select(
          `
          id,
          total,
          subtotal,
          tax,
          discount,
          created_at,
          status,
          payment_method,
          cashier_id
        `,
        )
        .eq(
          "branch_id",
          branchId!,
        )
        .eq(
          "status",
          "completed",
        )
        .gte(
          "created_at",
          since,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        );

      if (error) {
        throw error;
      }

      return (
        (data ?? []) as SaleRow[]
      );
    },
  });

  /*
   * ============================================================
   * PERIODO ANTERIOR
   * ============================================================
   */

  const {
    data: previousSales = [],
  } = useQuery({
    queryKey: [
      "report-sales-previous",
      branchId,
      rangeDays,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("sales")
        .select(
          "id, total, created_at",
        )
        .eq(
          "branch_id",
          branchId!,
        )
        .eq(
          "status",
          "completed",
        )
        .gte(
          "created_at",
          prevSince,
        )
        .lt(
          "created_at",
          prevUntil,
        );

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   * ============================================================
   */

  const {
    data: inventory = [],
    isLoading: loadingInventory,
  } = useQuery({
    queryKey: [
      "report-shared-inventory",
    ],

    queryFn: async () => {
      return (
        (await getSharedInventory()) as InventoryRow[]
      );
    },
  });

  /*
   * ============================================================
   * GASTOS
   * ============================================================
   *
   * El periodo ahora tiene límite superior.
   *
   * Antes:
   *
   *   >= fecha inicial
   *
   * Eso podía incluir gastos capturados con fecha futura.
   *
   * Ahora:
   *
   *   >= inicio
   *   <= hoy
   */

  const {
    data: expensesTotal = 0,
  } = useQuery({
    queryKey: [
      "report-expenses",
      branchId,
      rangeDays,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const sinceDate =
        since.slice(0, 10);

      const {
        data,
        error,
      } = await supabase
        .from("expenses")
        .select("amount")
        .eq(
          "branch_id",
          branchId!,
        )
        .gte(
          "expense_date",
          sinceDate,
        )
        .lte(
          "expense_date",
          todayDate,
        );

      if (error) {
        if (
          error.message?.includes(
            "does not exist",
          ) ||
          error.code === "42P01"
        ) {
          return 0;
        }

        throw error;
      }

      return (
        data ?? []
      ).reduce(
        (
          total,
          expense,
        ) =>
          total +
          Number(
            expense.amount ?? 0,
          ),
        0,
      );
    },
  });

  /*
   * ============================================================
   * ITEMS DE LAS VENTAS
   * ============================================================
   *
   * Se utiliza cost_total almacenado en el momento de la venta.
   *
   * NO se utiliza products.cost actual.
   */

  const saleIds = useMemo(
    () =>
      sales.map(
        (sale) => sale.id,
      ),
    [sales],
  );

  const {
    data: saleItems = [],
  } = useQuery({
    queryKey: [
      "report-sale-items-historical",
      saleIds.join(","),
    ],

    enabled:
      saleIds.length > 0,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("sale_items")
        .select(
          `
          sale_id,
          name_snapshot,
          quantity,
          unit_price,
          discount,
          total,
          product_id,
          variant_id,
          unit_cost,
          cost_total
        `,
        )
        .in(
          "sale_id",
          saleIds,
        );

      if (error) {
        throw error;
      }

      return (
        (data ??
          []) as SaleItemRow[]
      );
    },
  });

  /*
   * ============================================================
   * KPI PRINCIPALES
   * ============================================================
   */

  const totalSales = useMemo(
    () =>
      sales.reduce(
        (
          total,
          sale,
        ) =>
          total +
          Number(
            sale.total ?? 0,
          ),
        0,
      ),
    [sales],
  );

  const totalPreviousSales =
    useMemo(
      () =>
        previousSales.reduce(
          (
            total,
            sale,
          ) =>
            total +
            Number(
              sale.total ?? 0,
            ),
          0,
        ),
      [previousSales],
    );

  const ticketCount =
    sales.length;

  const averageTicket =
    ticketCount > 0
      ? totalSales /
        ticketCount
      : 0;

  const salesChange =
    totalPreviousSales > 0
      ? ((totalSales -
          totalPreviousSales) /
          totalPreviousSales) *
        100
      : totalSales > 0
        ? 100
        : 0;

  /*
   * ============================================================
   * COSTO HISTÓRICO
   * ============================================================
   */

  const historicalCost =
    useMemo(
      () =>
        saleItems.reduce(
          (
            total,
            item,
          ) => {
            if (
              item.cost_total !==
                null &&
              item.cost_total !==
                undefined
            ) {
              return (
                total +
                Number(
                  item.cost_total,
                )
              );
            }

            return (
              total +
              Number(
                item.unit_cost ??
                  0,
              ) *
                Number(
                  item.quantity ??
                    0,
                )
            );
          },
          0,
        ),
      [saleItems],
    );

  const itemRevenue =
    useMemo(
      () =>
        saleItems.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.total ?? 0,
            ),
          0,
        ),
      [saleItems],
    );

  const grossProfit =
    itemRevenue -
    historicalCost;

  const marginPercent =
    itemRevenue > 0
      ? (grossProfit /
          itemRevenue) *
        100
      : 0;

  const netProfit =
    grossProfit -
    Number(
      expensesTotal,
    );

  /*
   * ============================================================
   * INVENTARIO
   * ============================================================
   */

  const inventoryUnits =
    useMemo(
      () =>
        inventory.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.stock ?? 0,
            ),
          0,
        ),
      [inventory],
    );

  const inventoryReserved =
    useMemo(
      () =>
        inventory.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.reserved_stock ??
                0,
            ),
          0,
        ),
      [inventory],
    );

  const inventoryAvailable =
    useMemo(
      () =>
        inventory.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.available_stock ??
                0,
            ),
          0,
        ),
      [inventory],
    );

  const inventoryCost =
    useMemo(
      () =>
        inventory.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.stock ?? 0,
            ) *
              Number(
                item.cost ?? 0,
              ),
          0,
        ),
      [inventory],
    );

  const inventoryRetail =
    useMemo(
      () =>
        inventory.reduce(
          (
            total,
            item,
          ) =>
            total +
            Number(
              item.stock ?? 0,
            ) *
              Number(
                item.price ?? 0,
              ),
          0,
        ),
      [inventory],
    );

  const lowStock =
    useMemo(
      () =>
        inventory
          .filter(
            (item) =>
              Number(
                item.available_stock,
              ) <=
              Number(
                item.min_stock,
              ),
          )
          .sort(
            (
              a,
              b,
            ) =>
              Number(
                a.available_stock,
              ) -
              Number(
                b.available_stock,
              ),
          )
          .slice(
            0,
            20,
          ),
      [inventory],
    );

  /*
   * ============================================================
   * COBERTURA DEL INVENTARIO
   * ============================================================
   *
   * No se etiqueta como "periodos", porque el valor de inventario
   * dividido entre ventas no representa realmente meses o semanas.
   *
   * Se muestra como multiplicador del valor de ventas del periodo.
   */

  const inventorySalesMultiple =
    totalSales > 0
      ? inventoryRetail /
        totalSales
      : 0;

  /*
   * ============================================================
   * VENTAS POR MÉTODO DE PAGO
   * ============================================================
   */

  const paymentLabels: Record<
    string,
    string
  > = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer:
      "Transferencia",
    credit: "Crédito",
    mixed: "Mixto",
  };

  const byPayment =
    useMemo(() => {
      const map =
        new Map<
          string,
          number
        >();

      for (const sale of sales) {
        const method =
          sale.payment_method ??
          "cash";

        map.set(
          method,
          (map.get(
            method,
          ) ?? 0) +
            Number(
              sale.total ?? 0,
            ),
        );
      }

      return Array.from(
        map.entries(),
      )
        .map(
          ([
            method,
            total,
          ]) => ({
            method,
            label:
              paymentLabels[
                method
              ] ??
              method,
            total,
          }),
        )
        .sort(
          (a, b) =>
            b.total -
            a.total,
        );
    }, [sales]);

  /*
   * ============================================================
   * VENTAS POR DÍA
   * ============================================================
   */

  const byDay =
    useMemo(() => {
      const map =
        new Map<
          string,
          number
        >();

      for (const sale of sales) {
        const day =
          format(
            parseISO(
              sale.created_at,
            ),
            "yyyy-MM-dd",
          );

        map.set(
          day,
          (map.get(day) ??
            0) +
            Number(
              sale.total ?? 0,
            ),
        );
      }

      return Array.from(
        map.entries(),
      )
        .sort(
          (
            [a],
            [b],
          ) =>
            a.localeCompare(
              b,
            ),
        )
        .map(
          ([
            day,
            total,
          ]) => ({
            day,
            label:
              format(
                parseISO(day),
                "dd/MM",
              ),
            total:
              Math.round(
                total * 100,
              ) / 100,
          }),
        );
    }, [sales]);

  /*
   * ============================================================
   * TOP PRODUCTOS
   * ============================================================
   */

  const topProducts =
    useMemo(() => {
      const map =
        new Map<
          string,
          {
            key: string;
            name: string;
            quantity: number;
            revenue: number;
            cost: number;
          }
        >();

      for (const item of saleItems) {
        const key =
          item.product_id ??
          `snapshot:${item.name_snapshot}`;

        const current =
          map.get(key) ?? {
            key,
            name:
              item.name_snapshot,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };

        current.quantity +=
          Number(
            item.quantity ?? 0,
          );

        current.revenue +=
          Number(
            item.total ?? 0,
          );

        if (
          item.cost_total !==
            null &&
          item.cost_total !==
            undefined
        ) {
          current.cost +=
            Number(
              item.cost_total,
            );
        } else {
          current.cost +=
            Number(
              item.unit_cost ??
                0,
            ) *
            Number(
              item.quantity ?? 0,
            );
        }

        map.set(
          key,
          current,
        );
      }

      return Array.from(
        map.values(),
      )
        .map(
          (product) => {
            const profit =
              product.revenue -
              product.cost;

            return {
              ...product,
              profit,
              marginPercent:
                product.revenue >
                0
                  ? (profit /
                      product.revenue) *
                    100
                  : 0,
            };
          },
        )
        .sort(
          (a, b) =>
            b.revenue -
            a.revenue,
        )
        .slice(
          0,
          15,
        );
    }, [saleItems]);

  /*
   * ============================================================
   * ERROR
   * ============================================================
   */

  if (salesError) {
    return (
      <PageShell>
        <PageHeader
          icon={BarChart3}
          title="Reportes"
          description="Ventas, utilidad, costos históricos e inventario central."
        />

        <Card className="border-destructive/30">
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudieron cargar
            los reportes:{" "}
            {
              (
                salesError as Error
              ).message
            }
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Reportes"
        description="Ventas, utilidad real, costos históricos e inventario compartido."
        action={
          <Select
            value={rangeDays}
            onValueChange={
              setRangeDays
            }
          >
            <SelectTrigger className="w-[180px] rounded-xl">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {RANGES.map(
                (range) => (
                  <SelectItem
                    key={
                      range.value
                    }
                    value={
                      range.value
                    }
                  >
                    {
                      range.label
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        }
      />

      {/* ======================================================
          KPI PRINCIPALES
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Ventas"
          value={money(
            totalSales,
          )}
          icon={DollarSign}
          delta={
            salesChange
          }
          loading={
            loadingSales
          }
        />

        <KpiCard
          title="Ticket promedio"
          value={money(
            averageTicket,
          )}
          icon={Receipt}
          subtitle={`${ticketCount} ventas`}
          loading={
            loadingSales
          }
        />

        <KpiCard
          title="Utilidad bruta"
          value={money(
            grossProfit,
          )}
          icon={TrendingUp}
          subtitle={`Margen ${marginPercent.toFixed(
            1,
          )}%`}
          loading={
            loadingSales
          }
        />

        <KpiCard
          title="Utilidad neta"
          value={money(
            netProfit,
          )}
          icon={
            netProfit >= 0
              ? TrendingUp
              : TrendingDown
          }
          subtitle={`Gastos ${money(
            Number(
              expensesTotal,
            ),
          )}`}
          loading={
            loadingSales
          }
        />
      </div>

      {/* ======================================================
          KPI INVENTARIO
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Unidades en inventario"
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
          subtitle={`${inventoryReserved.toLocaleString(
            "es-MX",
          )} reservadas`}
          loading={
            loadingInventory
          }
        />

        <KpiCard
          title="Valor a costo"
          value={money(
            inventoryCost,
          )}
          icon={DollarSign}
          loading={
            loadingInventory
          }
        />

        <KpiCard
          title="Valor de venta"
          value={money(
            inventoryRetail,
          )}
          icon={TrendingUp}
          subtitle={
            inventorySalesMultiple > 0
              ? `≈ ${inventorySalesMultiple.toFixed(
                  1,
                )}x las ventas del periodo`
              : undefined
          }
          loading={
            loadingInventory
          }
        />
      </div>

      {/* ======================================================
          GRÁFICA
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Ventas por día
          </CardTitle>
        </CardHeader>

        <CardContent>
          {byDay.length ===
          0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin ventas en
              el periodo.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <BarChart
                  data={byDay}
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
                    width={60}
                  />

                  <Tooltip
                    formatter={(
                      value: number,
                    ) => [
                      money(
                        Number(
                          value,
                        ),
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
                totalSales,
              )}
            />

            <SummaryRow
              label="Costo de mercancía"
              value={money(
                historicalCost,
              )}
            />

            <SummaryRow
              label="Utilidad bruta"
              value={money(
                grossProfit,
              )}
              strong
            />

            <SummaryRow
              label="Margen bruto"
              value={`${marginPercent.toFixed(
                2,
              )}%`}
            />

            <SummaryRow
              label="Gastos"
              value={money(
                Number(
                  expensesTotal,
                ),
              )}
            />

            <div className="border-t pt-3">
              <SummaryRow
                label="Utilidad neta"
                value={money(
                  netProfit,
                )}
                strong
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Métodos de pago
            </CardTitle>
          </CardHeader>

          <CardContent>
            {byPayment.length ===
            0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin ventas.
              </p>
            ) : (
              <div className="space-y-3">
                {byPayment.map(
                  (payment) => (
                    <div
                      key={
                        payment.method
                      }
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">
                        {
                          payment.label
                        }
                      </span>

                      <span className="font-medium">
                        {money(
                          payment.total,
                        )}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ======================================================
          PRODUCTOS MÁS VENDIDOS
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Productos más vendidos
          </CardTitle>
        </CardHeader>

        <CardContent className="overflow-x-auto">
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
                  Ingresos
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
              {topProducts.map(
                (
                  product,
                  index,
                ) => (
                  <TableRow
                    key={
                      product.key
                    }
                  >
                    <TableCell className="text-muted-foreground">
                      {index + 1}
                    </TableCell>

                    <TableCell className="font-medium">
                      {
                        product.name
                      }
                    </TableCell>

                    <TableCell className="text-right">
                      {
                        product.quantity
                      }
                    </TableCell>

                    <TableCell className="text-right">
                      {money(
                        product.revenue,
                      )}
                    </TableCell>

                    <TableCell className="text-right text-muted-foreground">
                      {money(
                        product.cost,
                      )}
                    </TableCell>

                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        product.profit >=
                          0
                          ? "text-emerald-600"
                          : "text-destructive",
                      )}
                    >
                      {money(
                        product.profit,
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      {product.marginPercent.toFixed(
                        1,
                      )}
                      %
                    </TableCell>
                  </TableRow>
                ),
              )}

              {!topProducts.length && (
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
        </CardContent>
      </Card>

      {/* ======================================================
          STOCK BAJO
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Productos bajo mínimo
          </CardTitle>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {lowStock.length ===
          0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay productos
              bajo mínimo.
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
                        {
                          item.sku ??
                          "—"
                        }
                      </TableCell>

                      <TableCell className="text-right font-semibold">
                        {
                          item.available_stock
                        }
                      </TableCell>

                      <TableCell className="text-right">
                        {
                          item.min_stock
                        }
                      </TableCell>

                      <TableCell className="text-right">
                        {Number(
                          item.available_stock,
                        ) <= 0 ? (
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
        "flex items-center justify-between",
        strong &&
          "font-semibold",
      )}
    >
      <span>{label}</span>

      <span>{value}</span>
    </div>
  );
}

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
  subtitle?: string | undefined;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
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
                    delta >=
                      0
                      ? "text-emerald-600"
                      : "text-destructive",
                  )}
                >
                  {delta >=
                  0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}

                  {delta >=
                  0
                    ? "+"
                    : ""}
                  {delta.toFixed(
                    1,
                  )}
                  % vs periodo anterior
                </p>
              )}

            {subtitle &&
              !loading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {
                    subtitle
                  }
                </p>
              )}
          </div>

          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 