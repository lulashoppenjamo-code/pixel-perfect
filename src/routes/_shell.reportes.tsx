// ============================================================================
// RUTA: src/routes/_shell.reportes.tsx
// Copia TODO lo de abajo (sin estas 4 líneas de comentario) a: src/routes/_shell.reportes.tsx
// ============================================================================

/**
 * Reportes — LULA OS
 * Ruta: src/routes/_shell.reportes.tsx
 * Reemplaza el archivo existente completo.
 *
 * - Ventas por día
 * - Ticket promedio
 * - Productos más vendidos
 * - Margen / utilidad estimada
 * - Comparación periodo anterior
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { subDays, format, parseISO, startOfDay } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TrendingDown, TrendingUp, DollarSign, Receipt, Package, BarChart3 } from "lucide-react";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/reportes")({
  head: () => ({
    meta: [{ title: "Reportes — Lula OS" }],
  }),
  component: ReportesPage,
});

const RANGES = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
];

function ReportesPage() {
  const { branchId } = useBranch();
  const [rangeDays, setRangeDays] = useState("30");
  const days = Number(rangeDays);

  const since = useMemo(
    () => startOfDay(subDays(new Date(), days)).toISOString(),
    [days],
  );
  const prevSince = useMemo(
    () => startOfDay(subDays(new Date(), days * 2)).toISOString(),
    [days],
  );
  const prevUntil = since;

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ["report-sales", branchId, rangeDays],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "id, total, subtotal, tax, discount, created_at, status, payment_method, cashier_id",
        )
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: prevSales = [] } = useQuery({
    queryKey: ["report-sales-prev", branchId, rangeDays],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, total")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", prevSince)
        .lt("created_at", prevUntil);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: lowStock = [] } = useQuery({
    queryKey: ["report-low-stock", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("stock, min_stock, products(name, sku)")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? [])
        .filter((i) => Number(i.stock) <= Number(i.min_stock))
        .map((i) => ({
          stock: Number(i.stock),
          min_stock: Number(i.min_stock),
          name:
            (i.products as unknown as { name: string; sku: string | null } | null)?.name ??
            "—",
          sku:
            (i.products as unknown as { name: string; sku: string | null } | null)?.sku ??
            null,
        }))
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 20);
    },
  });

  const { data: expensesTotal = 0 } = useQuery({
    queryKey: ["report-expenses", branchId, rangeDays],
    enabled: !!branchId,
    queryFn: async () => {
      const sinceDate = since.slice(0, 10);
      const { data, error } = await supabase
        .from("expenses" as "products")
        .select("amount")
        .eq("branch_id", branchId!)
        .gte("expense_date", sinceDate);
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") return 0;
        throw error;
      }
      return ((data ?? []) as { amount: number }[]).reduce(
        (a, e) => a + Number(e.amount),
        0,
      );
    },
  });

  const saleIds = sales.map((s) => s.id);

  const { data: saleItems = [] } = useQuery({
    queryKey: ["report-sale-items", saleIds.join(",")],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("sale_id, name_snapshot, quantity, unit_price, discount, total, product_id")
        .in("sale_id", saleIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: productCosts = [] } = useQuery({
    queryKey: ["report-product-costs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, cost");
      if (error) throw error;
      return data ?? [];
    },
  });

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productCosts) m.set(p.id, Number(p.cost) || 0);
    return m;
  }, [productCosts]);

  // KPIs
  const totalSales = sales.reduce((a, s) => a + Number(s.total), 0);
  const totalPrev = prevSales.reduce((a, s) => a + Number(s.total), 0);
  const ticketCount = sales.length;
  const avgTicket = ticketCount ? totalSales / ticketCount : 0;
  const salesChange =
    totalPrev > 0 ? ((totalSales - totalPrev) / totalPrev) * 100 : totalSales > 0 ? 100 : 0;

  // Utilidad estimada (precio - costo) * qty - descuentos de línea
  let estimatedCost = 0;
  let estimatedRevenue = 0;
  for (const it of saleItems) {
    const qty = Number(it.quantity);
    const cost = it.product_id ? costMap.get(it.product_id) ?? 0 : 0;
    estimatedCost += cost * qty;
    estimatedRevenue += Number(it.total);
  }
  const estimatedMargin = estimatedRevenue - estimatedCost;
  const marginPct = estimatedRevenue > 0 ? (estimatedMargin / estimatedRevenue) * 100 : 0;
  const netUtility = estimatedMargin - expensesTotal;

  const byPayment = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) {
      const m = (s as { payment_method?: string }).payment_method ?? "cash";
      map.set(m, (map.get(m) ?? 0) + Number(s.total));
    }
    return Array.from(map.entries())
      .map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total);
  }, [sales]);

  const byCashier = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const s of sales) {
      const id = (s as { cashier_id?: string }).cashier_id ?? "—";
      const cur = map.get(id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(s.total);
      map.set(id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [sales]);

  const PAY_LABEL: Record<string, string> = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
    credit: "Crédito",
    mixed: "Mixto",
  };

  // Ventas por día
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) {
      const day = format(parseISO(s.created_at), "yyyy-MM-dd");
      map.set(day, (map.get(day) ?? 0) + Number(s.total));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, total]) => ({
        day,
        label: format(parseISO(day), "dd/MM"),
        total: Math.round(total * 100) / 100,
      }));
  }, [sales]);

  // Top productos
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      { name: string; quantity: number; total: number; cost: number }
    >();
    for (const it of saleItems) {
      const key = it.name_snapshot;
      const cur = map.get(key) ?? {
        name: key,
        quantity: 0,
        total: 0,
        cost: 0,
      };
      const qty = Number(it.quantity);
      const unitCost = it.product_id ? costMap.get(it.product_id) ?? 0 : 0;
      cur.quantity += qty;
      cur.total += Number(it.total);
      cur.cost += unitCost * qty;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((p) => ({
        ...p,
        margin: p.total - p.cost,
        marginPct: p.total > 0 ? ((p.total - p.cost) / p.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [saleItems, costMap]);

  return (
    <PageShell className="space-y-5">
      <PageHeader
        icon={BarChart3}
        title="Reportes"
        description="Ventas, utilidad, métodos de pago, stock bajo y top productos."
        action={
          <Select value={rangeDays} onValueChange={setRangeDays}>
            <SelectTrigger className="w-[180px] rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* KPI cards */}
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
          value={money(avgTicket)}
          icon={Receipt}
          subtitle={`${ticketCount} ventas`}
          loading={loadingSales}
        />
        <KpiCard
          title="Utilidad estimada"
          value={money(estimatedMargin)}
          icon={TrendingUp}
          subtitle={`Margen ${marginPct.toFixed(1)}%`}
          loading={loadingSales}
        />
        <KpiCard
          title="Periodo anterior"
          value={money(totalPrev)}
          icon={Package}
          subtitle={`vs ${days} días previos`}
          loading={loadingSales}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ventas por día</CardTitle>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin ventas en el periodo.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={60} />
                  <Tooltip
                    formatter={(v: number) => [money(v), "Ventas"]}
                    contentStyle={{ borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top products */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Productos más vendidos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Costo est.</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
                <TableHead className="text-right">Margen %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map((p, i) => (
                <TableRow key={p.name}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right">{p.quantity}</TableCell>
                  <TableCell className="text-right">{money(p.total)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(p.cost)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      p.margin >= 0 ? "text-emerald-600" : "text-destructive",
                    )}
                  >
                    {money(p.margin)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {p.marginPct.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
              {!topProducts.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Sin datos de productos en el periodo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
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
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">
              {loading ? "…" : value}
            </p>
            {delta !== undefined && !loading && (
              <p
                className={cn(
                  "mt-1 flex items-center gap-1 text-xs font-medium",
                  delta >= 0 ? "text-emerald-600" : "text-destructive",
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
            {subtitle && !delta && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
            {subtitle && delta !== undefined && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
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
