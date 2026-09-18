import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { subDays, format, parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_shell/reportes")({
  head: () => ({
    meta: [
      { title: "Reportes — Lula Shop OS" },
      { name: "description", content: "Ventas por periodo, productos más vendidos y ticket promedio." },
      { property: "og:title", content: "Reportes — Lula Shop OS" },
      { property: "og:description", content: "Ventas por periodo, productos más vendidos y ticket promedio." },
    ],
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

  const since = useMemo(() => startOfDay(subDays(new Date(), Number(rangeDays))).toISOString(), [rangeDays]);

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ["report-sales", branchId, rangeDays],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, total, created_at, status")
        .eq("branch_id", branchId!)
        .eq("status", "completed")
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: saleItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["report-sale-items", branchId, rangeDays],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("name_snapshot, quantity, total, sales!inner(branch_id, status, created_at)")
        .eq("sales.branch_id", branchId!)
        .eq("sales.status", "completed")
        .gte("sales.created_at", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) {
      const day = format(parseISO(s.created_at), "d MMM");
      map.set(day, (map.get(day) ?? 0) + Number(s.total));
    }
    return Array.from(map.entries()).map(([day, total]) => ({ day, total }));
  }, [sales]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number; total: number }>();
    for (const it of saleItems) {
      const key = it.name_snapshot;
      const prev = map.get(key) ?? { name: key, quantity: 0, total: 0 };
      prev.quantity += Number(it.quantity);
      prev.total += Number(it.total);
      map.set(key, prev);
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [saleItems]);

  const totalRevenue = sales.reduce((s, r) => s + Number(r.total), 0);
  const totalSales = sales.length;
  const avgTicket = totalSales ? totalRevenue / totalSales : 0;
  const loading = loadingSales || loadingItems;

  if (!branchId) {
    return <p className="text-sm text-muted-foreground">Selecciona una sucursal para ver sus reportes.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Reportes</h1>
        <Select value={rangeDays} onValueChange={setRangeDays}>
          <SelectTrigger className="w-48">
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
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ventas totales</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{money(totalRevenue)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Número de ventas</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{totalSales}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ticket promedio</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{money(avgTicket)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ventas por día</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : byDay.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sin ventas en este periodo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Productos más vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map((p) => (
                <TableRow key={p.name}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.quantity}</TableCell>
                  <TableCell>{money(p.total)}</TableCell>
                </TableRow>
              ))}
              {!topProducts.length && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Sin datos en este periodo.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}