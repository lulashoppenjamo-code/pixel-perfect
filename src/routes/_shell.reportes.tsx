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
  addDays,
  format,
  parseISO,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
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
  Users,
  ChevronRight,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
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
        title: "Informes — Lula OS",
      },
      {
        name: "description",
        content:
          "Reportes de ventas, utilidad, costos históricos, inventario compartido, clientes y productos.",
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
  { value: "today", label: "Hoy" },
  { value: "day", label: "Día específico" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "year", label: "Este año" },
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "custom", label: "Periodo personalizado" },
  { value: "all", label: "General / Todo" },
];

/**
 * Recupera todos los registros por páginas de 1000.
 */
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await buildQuery(
      offset,
      offset + pageSize - 1,
    );

    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < pageSize) break;

    offset += pageSize;
  }

  return rows;
}

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
  customer_id: string | null;
  branch_id: string;
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
  const { branchId, branches } = useBranch();
  const { roles } = useAuth();

  const isOwnerOrAdmin =
    roles.includes("owner") || roles.includes("admin");

  const [rangeDays, setRangeDays] = useState("30");
  const [reportBranchId, setReportBranchId] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");

  const today = format(new Date(), "yyyy-MM-dd");

  const [specificDate, setSpecificDate] = useState(today);
  const [customFrom, setCustomFrom] = useState(
    format(startOfMonth(new Date()), "yyyy-MM-dd"),
  );
  const [customTo, setCustomTo] = useState(today);

  // Los usuarios normales nunca pueden activar la vista global.
  const selectedBranchId = isOwnerOrAdmin
    ? reportBranchId
    : branchId ?? "";

  const canLoadReports = isOwnerOrAdmin
    ? selectedBranchId === "all" || !!selectedBranchId
    : !!selectedBranchId;

  /*
   * ============================================================
   * PERIODOS GLOBALES
   * ============================================================
   * El mismo intervalo alimenta ventas, gastos,
   * productos, clientes y todos los indicadores.
   */

  const period = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);

    let start = todayStart;
    let endExclusive = addDays(todayStart, 1);

    if (rangeDays === "today") {
      start = todayStart;
    } else if (rangeDays === "day") {
      start = startOfDay(parseISO(`${specificDate}T00:00:00`));
      endExclusive = addDays(start, 1);
    } else if (rangeDays === "week") {
      start = startOfWeek(todayStart, { weekStartsOn: 1 });
    } else if (rangeDays === "month") {
      start = startOfMonth(todayStart);
    } else if (rangeDays === "year") {
      start = startOfYear(todayStart);
    } else if (rangeDays === "custom") {
      start = startOfDay(parseISO(`${customFrom}T00:00:00`));
      endExclusive = addDays(
        startOfDay(parseISO(`${customTo}T00:00:00`)),
        1,
      );
    } else if (rangeDays === "all") {
      start = new Date(2000, 0, 1);
    } else {
      const days = Number(rangeDays);
      start = startOfDay(subDays(todayStart, days - 1));
    }

    if (endExclusive <= start) {
      endExclusive = addDays(start, 1);
    }

    const durationDays = Math.max(
      1,
      Math.ceil(
        (endExclusive.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );

    return {
      start,
      endExclusive,
      durationDays,
      since: start.toISOString(),
      until: endExclusive.toISOString(),
      startDate: format(start, "yyyy-MM-dd"),
      endDate: format(subDays(endExclusive, 1), "yyyy-MM-dd"),
    };
  }, [rangeDays, specificDate, customFrom, customTo]);

  const since = period.since;
  const until = period.until;
  const prevSince = subDays(
    period.start,
    period.durationDays,
  ).toISOString();
  const prevUntil = since;

  /*
   * ============================================================
   * EMPLEADOS
   * ============================================================
   * Se usa el perfil real para mostrar nombres.
   */

  const { data: employees = [] } = useQuery({
    queryKey: ["report-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");

      if (error) throw error;

      return data ?? [];
    },
  });

  const employeeNames = useMemo(() => {
    return new Map(
      employees.map((employee) => [
        employee.id,
        employee.full_name || "Usuario sin nombre",
      ]),
    );
  }, [employees]);

  /*
   * ============================================================
   * VENTAS ACTUALES
   * ============================================================
   * Consulta global únicamente para owner/admin.
   * Usuarios normales conservan su sucursal autorizada.
   */

  const {
    data: sales = [],
    isLoading: loadingSales,
    error: salesError,
  } = useQuery({
    queryKey: [
      "report-sales",
      selectedBranchId,
      rangeDays,
      since,
      until,
      employeeId,
    ],

    enabled: canLoadReports,

    refetchInterval: 15000,
    refetchOnWindowFocus: true,

    queryFn: async () =>
      fetchAllRows<SaleRow>((from, to) => {
        let query = supabase
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
            cashier_id,
            customer_id,
            branch_id
          `,
          )
          .eq("status", "completed")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });

        if (selectedBranchId !== "all") {
          query = query.eq("branch_id", selectedBranchId);
        }

        if (employeeId !== "all") {
          query = query.eq("cashier_id", employeeId);
        }

        return query.range(from, to);
      }),
  });

  /*
   * ============================================================
   * PERIODO ANTERIOR
   * ============================================================
   * No se compara contra un periodo arbitrario cuando
   * el usuario selecciona "General / Todo".
   */

  const { data: previousSales = [] } = useQuery({
    queryKey: [
      "report-sales-previous",
      selectedBranchId,
      rangeDays,
      prevSince,
      prevUntil,
      employeeId,
    ],

    enabled: canLoadReports && rangeDays !== "all",

    queryFn: async () =>
      fetchAllRows<{
        id: string;
        total: number;
        created_at: string;
      }>((from, to) => {
        let query = supabase
          .from("sales")
          .select("id, total, created_at")
          .eq("status", "completed")
          .gte("created_at", prevSince)
          .lt("created_at", prevUntil)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true });

        if (selectedBranchId !== "all") {
          query = query.eq("branch_id", selectedBranchId);
        }

        if (employeeId !== "all") {
          query = query.eq("cashier_id", employeeId);
        }

        return query.range(from, to);
      }),
  });

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   * ============================================================
   */

  const { data: inventory = [], isLoading: loadingInventory } =
    useQuery({
      queryKey: ["report-shared-inventory"],

      queryFn: async () => {
        return (await getSharedInventory()) as InventoryRow[];
      },
    });

  /*
   * ============================================================
   * GASTOS
   * ============================================================
   */

  const { data: expensesTotal = 0 } = useQuery({
    queryKey: [
      "report-expenses",
      selectedBranchId,
      rangeDays,
      since,
      until,
      employeeId,
    ],

    enabled: canLoadReports,

    queryFn: async () => {
      try {
        const expenses = await fetchAllRows<{
          amount: number;
          created_by: string | null;
        }>((from, to) => {
          let query = supabase
            .from("expenses")
            .select("amount, created_by")
            .gte("expense_date", period.startDate)
            .lte("expense_date", period.endDate)
            .order("expense_date", { ascending: true });

          if (selectedBranchId !== "all") {
            query = query.eq("branch_id", selectedBranchId);
          }

          if (employeeId !== "all") {
            query = query.eq("created_by", employeeId);
          }

          return query.range(from, to);
        });

        return expenses.reduce(
          (total, expense) => total + Number(expense.amount ?? 0),
          0,
        );
      } catch (error: any) {
        if (
          error.message?.includes("does not exist") ||
          error.code === "42P01"
        ) {
          return 0;
        }

        throw error;
      }
    },
  });

  /*
   * ============================================================
   * ITEMS DE LAS VENTAS
   * ============================================================
   *
   * Se utiliza cost_total histórico.
   * Nunca se utiliza el costo actual del producto
   * para calcular utilidad histórica.
   */

  const saleIds = useMemo(
    () => sales.map((sale) => sale.id),
    [sales],
  );

  const { data: saleItems = [], isLoading: loadingSaleItems } =
    useQuery({
      queryKey: [
        "report-sale-items-historical",
        saleIds.join(","),
      ],

      enabled: saleIds.length > 0,

      queryFn: async () => {
        const idChunkSize = 200;
        const allItems: SaleItemRow[] = [];

        for (
          let index = 0;
          index < saleIds.length;
          index += idChunkSize
        ) {
          const ids = saleIds.slice(index, index + idChunkSize);

          const chunkItems = await fetchAllRows<SaleItemRow>(
            (from, to) =>
              supabase
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
                .in("sale_id", ids)
                .order("sale_id", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to),
          );

          allItems.push(...chunkItems);
        }

        return allItems;
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
        (total, sale) => total + Number(sale.total ?? 0),
        0,
      ),
    [sales],
  );

  const totalPreviousSales = useMemo(
    () =>
      previousSales.reduce(
        (total, sale) => total + Number(sale.total ?? 0),
        0,
      ),
    [previousSales],
  );

  const ticketCount = sales.length;

  const averageTicket =
    ticketCount > 0 ? totalSales / ticketCount : 0;

  const salesChange =
    rangeDays === "all"
      ? 0
      : totalPreviousSales > 0
        ? ((totalSales - totalPreviousSales) /
            totalPreviousSales) *
          100
        : totalSales > 0
          ? 100
          : 0;

  /*
   * ============================================================
   * CLIENTES
   * ============================================================
   *
   * Solo contamos clientes vinculados a las ventas.
   *
   * Las ventas sin customer_id no se inventan como clientes.
   */

  const customerCount = useMemo(() => {
    const ids = new Set<string>();

    for (const sale of sales) {
      if (sale.customer_id) {
        ids.add(sale.customer_id);
      }
    }

    return ids.size;
  }, [sales]);

  const salesWithoutCustomer = useMemo(
    () => sales.filter((sale) => !sale.customer_id).length,
    [sales],
  );

  const customerAverageSpend =
    customerCount > 0 ? totalSales / customerCount : 0;

  /*
   * ============================================================
   * UNIDADES VENDIDAS
   * ============================================================
   */

  const unitsSold = useMemo(
    () =>
      saleItems.reduce(
        (total, item) => total + Number(item.quantity ?? 0),
        0,
      ),
    [saleItems],
  );

  const averageUnitsPerSale =
    ticketCount > 0 ? unitsSold / ticketCount : 0;

  /*
   * ============================================================
   * COSTO HISTÓRICO
   * ============================================================
   */

  const historicalCost = useMemo(
    () =>
      saleItems.reduce((total, item) => {
        if (
          item.cost_total !== null &&
          item.cost_total !== undefined
        ) {
          return total + Number(item.cost_total);
        }

        return (
          total +
          Number(item.unit_cost ?? 0) *
            Number(item.quantity ?? 0)
        );
      }, 0),
    [saleItems],
  );

  const itemRevenue = useMemo(
    () =>
      saleItems.reduce(
        (total, item) => total + Number(item.total ?? 0),
        0,
      ),
    [saleItems],
  );

  const grossProfit = itemRevenue - historicalCost;

  const marginPercent =
    itemRevenue > 0 ? (grossProfit / itemRevenue) * 100 : 0;

  const netProfit = grossProfit - Number(expensesTotal);

  /*
   * ============================================================
   * INVENTARIO
   * ============================================================
   */

  const inventoryUnits = useMemo(
    () =>
      inventory.reduce(
        (total, item) => total + Number(item.stock ?? 0),
        0,
      ),
    [inventory],
  );

  const inventoryReserved = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total + Number(item.reserved_stock ?? 0),
        0,
      ),
    [inventory],
  );

  const inventoryAvailable = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total + Number(item.available_stock ?? 0),
        0,
      ),
    [inventory],
  );

  const inventoryCost = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          Number(item.stock ?? 0) * Number(item.cost ?? 0),
        0,
      ),
    [inventory],
  );

  const inventoryRetail = useMemo(
    () =>
      inventory.reduce(
        (total, item) =>
          total +
          Number(item.stock ?? 0) * Number(item.price ?? 0),
        0,
      ),
    [inventory],
  );

  const lowStock = useMemo(
    () =>
      inventory
        .filter(
          (item) =>
            Number(item.available_stock) <=
            Number(item.min_stock),
        )
        .sort(
          (a, b) =>
            Number(a.available_stock) -
            Number(b.available_stock),
        )
        .slice(0, 20),
    [inventory],
  );

  /*
   * ============================================================
   * COBERTURA DEL INVENTARIO
   * ============================================================
   */

  const inventorySalesMultiple =
    totalSales > 0 ? inventoryRetail / totalSales : 0;

  /*
   * ============================================================
   * VENTAS POR MÉTODO DE PAGO
   * ============================================================
   */

  const paymentLabels: Record<string, string> = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
    credit: "Crédito",
    mixed: "Mixto",
  };

  const byPayment = useMemo(() => {
    const map = new Map<string, number>();

    for (const sale of sales) {
      const method = sale.payment_method ?? "cash";

      map.set(
        method,
        (map.get(method) ?? 0) + Number(sale.total ?? 0),
      );
    }

    return Array.from(map.entries())
      .map(([method, total]) => ({
        method,
        label: paymentLabels[method] ?? method,
        total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [sales]);

  /*
   * ============================================================
   * VENTAS POR DÍA
   * ============================================================
   */

  const byDay = useMemo(() => {
    const map = new Map<string, number>();

    for (const sale of sales) {
      const day = format(parseISO(sale.created_at), "yyyy-MM-dd");

      map.set(day, (map.get(day) ?? 0) + Number(sale.total ?? 0));
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, total]) => ({
        day,
        label: format(parseISO(day), "dd/MM"),
        total: Math.round(total * 100) / 100,
      }));
  }, [sales]);

  /*
   * ============================================================
   * TOP PRODUCTOS
   * ============================================================
   */

  const topProducts = useMemo(() => {
    const map = new Map<
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
        item.product_id ?? `snapshot:${item.name_snapshot}`;

      const current = map.get(key) ?? {
        key,
        name: item.name_snapshot,
        quantity: 0,
        revenue: 0,
        cost: 0,
      };

      current.quantity += Number(item.quantity ?? 0);

      current.revenue += Number(item.total ?? 0);

      if (
        item.cost_total !== null &&
        item.cost_total !== undefined
      ) {
        current.cost += Number(item.cost_total);
      } else {
        current.cost +=
          Number(item.unit_cost ?? 0) *
          Number(item.quantity ?? 0);
      }

      map.set(key, current);
    }

    return Array.from(map.values())
      .map((product) => {
        const profit = product.revenue - product.cost;

        return {
          ...product,
          profit,
          marginPercent:
            product.revenue > 0
              ? (profit / product.revenue) * 100
              : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);
  }, [saleItems]);

  /*
   * ============================================================
   * DESGLOSE INTEGRADO POR SUCURSAL Y EMPLEADO
   * ============================================================
   */

  const salesBreakdown = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        branchName: string;
        employeeName: string;
        tickets: number;
        total: number;
      }
    >();

    for (const sale of sales) {
      const key = `${sale.branch_id}:${sale.cashier_id}`;

      const branchName =
        branches.find((branch) => branch.id === sale.branch_id)
          ?.name ?? "Sucursal";

      const employeeName =
        employeeNames.get(sale.cashier_id) ??
        "Usuario sin nombre";

      const current = grouped.get(key) ?? {
        key,
        branchName,
        employeeName,
        tickets: 0,
        total: 0,
      };

      current.tickets += 1;
      current.total += Number(sale.total ?? 0);

      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => b.total - a.total,
    );
  }, [sales, branches, employeeNames]);

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
          title="Informes"
          description="Ventas, utilidad, costos históricos e inventario central."
        />

        <Card className="border-destructive/30">
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudieron cargar los reportes:{" "}
            {(salesError as Error).message}
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Informes"
        description="Resumen integrado de ventas, empleados, sucursales, utilidad e inventario."
      />

      {/* FILTROS GLOBALES DEL INFORME */}
      <Card className="border-[#e0e0e0] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Filtros del informe
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Todos los indicadores de ventas se actualizan con estos filtros.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Periodo
              </label>

              <Select
                value={rangeDays}
                onValueChange={setRangeDays}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Seleccionar periodo" />
                </SelectTrigger>

                <SelectContent>
                  {RANGES.map((range) => (
                    <SelectItem
                      key={range.value}
                      value={range.value}
                    >
                      {range.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isOwnerOrAdmin && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Sucursal
                </label>

                <Select
                  value={reportBranchId}
                  onValueChange={setReportBranchId}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="Seleccionar sucursal" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all">
                      Todas las sucursales
                    </SelectItem>

                    {branches.map((branch) => (
                      <SelectItem
                        key={branch.id}
                        value={branch.id}
                      >
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Empleado / Cajero
              </label>

              <Select
                value={employeeId}
                onValueChange={setEmployeeId}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Todos los empleados" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Todos los empleados
                  </SelectItem>

                  {employees.map((employee) => (
                    <SelectItem
                      key={employee.id}
                      value={employee.id}
                    >
                      {employee.full_name || "Usuario sin nombre"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {rangeDays === "day" && (
            <div className="max-w-xs space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Seleccionar día
              </label>

              <input
                type="date"
                value={specificDate}
                max={today}
                onChange={(event) =>
                  setSpecificDate(event.target.value)
                }
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              />
            </div>
          )}

          {rangeDays === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Desde
                </label>

                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) =>
                    setCustomFrom(event.target.value)
                  }
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Hasta
                </label>

                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={today}
                  onChange={(event) =>
                    setCustomTo(event.target.value)
                  }
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>
              Periodo: {period.startDate} al {period.endDate}
            </span>

            <span>
              Actualización automática cada 15 segundos
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Lista estilo Zobaze — métricas principales */}
      <div className="overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
        <ReportRow
          label="RECUENTO TOTAL DE RECIBOS"
          value={loadingSales ? "…" : String(ticketCount)}
        />
        <ReportRow
          label="VENTAS TOTALES"
          value={loadingSales ? "…" : money(totalSales)}
          highlight
        />
        <ReportRow
          label="VALOR MEDIO DE LAS VENTAS"
          value={loadingSales ? "…" : money(averageTicket)}
        />
        <ReportRow
          label="DESCUENTO"
          value={
            loadingSales
              ? "…"
              : money(
                  sales.reduce(
                    (s, sale) => s + Number(sale.discount ?? 0),
                    0,
                  ),
                )
          }
        />
        <ReportRow
          label="IMPUESTO"
          value={
            loadingSales
              ? "…"
              : money(
                  sales.reduce(
                    (s, sale) => s + Number(sale.tax ?? 0),
                    0,
                  ),
                )
          }
        />
        <ReportRow
          label="UTILIDAD BRUTA"
          value={
            loadingSaleItems || loadingSales
              ? "…"
              : money(grossProfit)
          }
          highlight
          last
        />
      </div>

      {/* ======================================================
          KPI PRINCIPALES
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Ventas"
          value={money(totalSales)}
          icon={DollarSign}
          delta={salesChange}
          loading={loadingSales}
        />

        <KpiCard
          title="Ticket promedio"
          value={money(averageTicket)}
          icon={Receipt}
          subtitle={`${ticketCount} ventas`}
          loading={loadingSales}
        />

        <KpiCard
          title="Unidades vendidas"
          value={unitsSold.toLocaleString("es-MX")}
          icon={Package}
          subtitle={`${averageUnitsPerSale.toFixed(1)} por venta`}
          loading={loadingSaleItems || loadingSales}
        />

        <KpiCard
          title="Clientes"
          value={customerCount.toLocaleString("es-MX")}
          icon={Users}
          subtitle={
            customerCount > 0
              ? `${money(customerAverageSpend)} por cliente`
              : salesWithoutCustomer > 0
                ? `${salesWithoutCustomer} ventas sin cliente`
                : undefined
          }
          loading={loadingSales}
        />
      </div>

      {/* DESGLOSE DE VENTAS POR SUCURSAL Y EMPLEADO */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Ventas por sucursal y empleado
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Desglose de tickets e importe dentro de los filtros seleccionados.
          </p>
        </CardHeader>

        <CardContent className="max-w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sucursal</TableHead>
                <TableHead>Empleado</TableHead>
                <TableHead className="text-right">
                  Tickets
                </TableHead>
                <TableHead className="text-right">
                  Venta promedio
                </TableHead>
                <TableHead className="text-right">
                  Total vendido
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {salesBreakdown.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">
                    {row.branchName}
                  </TableCell>

                  <TableCell>{row.employeeName}</TableCell>

                  <TableCell className="text-right">
                    {row.tickets.toLocaleString("es-MX")}
                  </TableCell>

                  <TableCell className="text-right">
                    {money(
                      row.tickets > 0 ? row.total / row.tickets : 0,
                    )}
                  </TableCell>

                  <TableCell className="text-right font-semibold">
                    {money(row.total)}
                  </TableCell>
                </TableRow>
              ))}

              {salesBreakdown.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No hay ventas para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ======================================================
          UTILIDAD
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Utilidad bruta"
          value={money(grossProfit)}
          icon={TrendingUp}
          subtitle={`Margen ${marginPercent.toFixed(1)}%`}
          loading={loadingSaleItems || loadingSales}
        />

        <KpiCard
          title="Utilidad neta"
          value={money(netProfit)}
          icon={netProfit >= 0 ? TrendingUp : TrendingDown}
          subtitle={`Gastos ${money(Number(expensesTotal))}`}
          loading={loadingSaleItems || loadingSales}
        />

        <KpiCard
          title="Costo de mercancía"
          value={money(historicalCost)}
          icon={Package}
          loading={loadingSaleItems || loadingSales}
        />

        <KpiCard
          title="Margen bruto"
          value={`${marginPercent.toFixed(1)}%`}
          icon={TrendingUp}
          subtitle="Sobre ventas"
          loading={loadingSaleItems || loadingSales}
        />
      </div>

      {/* ======================================================
          KPI INVENTARIO
      ======================================================= */}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Unidades en inventario"
          value={inventoryUnits.toLocaleString("es-MX")}
          icon={Boxes}
          loading={loadingInventory}
        />

        <KpiCard
          title="Disponibles"
          value={inventoryAvailable.toLocaleString("es-MX")}
          icon={Package}
          subtitle={`${inventoryReserved.toLocaleString(
            "es-MX",
          )} reservadas`}
          loading={loadingInventory}
        />

        <KpiCard
          title="Valor a costo"
          value={money(inventoryCost)}
          icon={DollarSign}
          loading={loadingInventory}
        />

        <KpiCard
          title="Valor de venta"
          value={money(inventoryRetail)}
          icon={TrendingUp}
          subtitle={
            inventorySalesMultiple > 0
              ? `≈ ${inventorySalesMultiple.toFixed(
                  1,
                )}x las ventas del periodo`
              : undefined
          }
          loading={loadingInventory}
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
          {byDay.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#757575] sm:py-12">
              Sin ventas en el periodo seleccionado.
            </p>
          ) : (
            <div className="h-52 w-full sm:h-64 md:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byDay}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />

                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                  />

                  <YAxis tick={{ fontSize: 11 }} width={60} />

                  <Tooltip
                    formatter={(value: number) => [
                      money(Number(value)),
                      "Ventas",
                    ]}
                    contentStyle={{ borderRadius: 8 }}
                  />

                  <Bar
                    dataKey="total"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          RESUMEN FINANCIERO + CLIENTES
      ======================================================= */}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Resumen financiero
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <SummaryRow label="Ventas" value={money(totalSales)} />

            <SummaryRow
              label="Costo de mercancía"
              value={money(historicalCost)}
            />

            <SummaryRow
              label="Utilidad bruta"
              value={money(grossProfit)}
              strong
            />

            <SummaryRow
              label="Margen bruto"
              value={`${marginPercent.toFixed(2)}%`}
            />

            <SummaryRow
              label="Gastos"
              value={money(Number(expensesTotal))}
            />

            <div className="border-t pt-3">
              <SummaryRow
                label="Utilidad neta"
                value={money(netProfit)}
                strong
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Clientes y ventas
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <SummaryRow
              label="Clientes con compra"
              value={customerCount.toLocaleString("es-MX")}
              strong
            />

            <SummaryRow
              label="Ventas"
              value={ticketCount.toLocaleString("es-MX")}
            />

            <SummaryRow
              label="Unidades vendidas"
              value={unitsSold.toLocaleString("es-MX")}
            />

            <SummaryRow
              label="Unidades por venta"
              value={averageUnitsPerSale.toFixed(1)}
            />

            <SummaryRow
              label="Venta promedio por cliente"
              value={money(customerAverageSpend)}
            />

            {salesWithoutCustomer > 0 && (
              <div className="border-t pt-3">
                <SummaryRow
                  label="Ventas sin cliente"
                  value={salesWithoutCustomer.toLocaleString(
                    "es-MX",
                  )}
                />
              </div>
            )}
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
          {byPayment.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin ventas.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {byPayment.map((payment) => (
                <div
                  key={payment.method}
                  className="rounded-xl border p-4"
                >
                  <p className="text-sm text-muted-foreground">
                    {payment.label}
                  </p>

                  <p className="mt-1 text-lg font-semibold">
                    {money(payment.total)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          PRODUCTOS MÁS VENDIDOS
      ======================================================= */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Productos más vendidos
          </CardTitle>
        </CardHeader>

        <CardContent className="max-w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>

                <TableHead>Producto</TableHead>

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
              {topProducts.map((product, index) => (
                <TableRow key={product.key}>
                  <TableCell className="text-muted-foreground">
                    {index + 1}
                  </TableCell>

                  <TableCell className="font-medium">
                    {product.name}
                  </TableCell>

                  <TableCell className="text-right">
                    {product.quantity}
                  </TableCell>

                  <TableCell className="text-right">
                    {money(product.revenue)}
                  </TableCell>

                  <TableCell className="text-right text-muted-foreground">
                    {money(product.cost)}
                  </TableCell>

                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      product.profit >= 0
                        ? "text-emerald-600"
                        : "text-destructive",
                    )}
                  >
                    {money(product.profit)}
                  </TableCell>

                  <TableCell className="text-right">
                    {product.marginPercent.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}

              {!topProducts.length && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Sin datos de productos.
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

        <CardContent className="max-w-full overflow-x-auto">
          {lowStock.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay productos bajo mínimo.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>

                  <TableHead>SKU</TableHead>

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
                {lowStock.map((item) => (
                  <TableRow
                    key={`${item.product_id}-${item.variant_id ?? "base"}`}
                  >
                    <TableCell className="font-medium">
                      {item.product_name}
                    </TableCell>

                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.sku ?? "—"}
                    </TableCell>

                    <TableCell className="text-right font-semibold">
                      {item.available_stock}
                    </TableCell>

                    <TableCell className="text-right">
                      {item.min_stock}
                    </TableCell>

                    <TableCell className="text-right">
                      {Number(item.available_stock) <= 0 ? (
                        <Badge variant="destructive">
                          Agotado
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Bajo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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
        strong && "font-semibold",
      )}
    >
      <span>{label}</span>

      <span>{value}</span>
    </div>
  );
}

/** Fila de métrica estilo Zobaze (lista densa) */
function ReportRow({
  label,
  value,
  highlight,
  last,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3.5 py-3 sm:px-4 sm:py-3.5",
        !last && "border-b border-[#f0f0f0]",
      )}
    >
      <span className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-[#757575] sm:text-[11px]">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn(
            "text-[15px] font-bold tabular-nums sm:text-base",
            highlight ? "text-[#1a73e8]" : "text-[#212121]",
          )}
        >
          {value}
        </span>
        <ChevronRight className="h-4 w-4 text-[#bdbdbd]" />
      </div>
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
    <Card className="border-[#e0e0e0] shadow-sm">
      <CardContent className="p-3.5 sm:pt-4 sm:p-6">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#757575] sm:text-xs sm:normal-case sm:tracking-normal sm:text-muted-foreground">
              {title}
            </p>

            <p className="mt-1 truncate text-xl font-bold tracking-tight text-[#1a73e8] sm:text-2xl">
              {loading ? "…" : value}
            </p>

            {delta !== undefined && !loading && (
              <p
                className={cn(
                  "mt-1 flex items-center gap-1 text-xs font-medium",
                  delta >= 0
                    ? "text-emerald-600"
                    : "text-destructive",
                )}
              >
                {delta >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}

                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}% vs periodo anterior
              </p>
            )}

            {subtitle && !loading && (
              <p className="mt-1 text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-[#e8f0fe] p-2">
            <Icon className="h-5 w-5 text-[#1a73e8]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
