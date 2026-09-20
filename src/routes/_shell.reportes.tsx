import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_shell/reportes")({
  head: () => ({
    meta: [
      { title: "Reportes de venta — Lula Shop OS" },
      { name: "description", content: "Ventas por periodo, ticket promedio y los productos más vendidos de cada sucursal." },
      { property: "og:title", content: "Reportes de venta — Lula Shop OS" },
      { property: "og:description", content: "Ventas por periodo, ticket promedio y los productos más vendidos de cada sucursal." },
    ],
  }),
  component: ReportesPage,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

function ReportesPage() {
  const { branchId } = useBranch();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));

  const { data: sales = [] } = useQuery({
    queryKey: ["report-sales", branchId, from, to],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, folio, total, payment_method, status, created_at")
        .eq("branch_id", branchId!)
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["report-items", branchId, from, to],
    enabled: !!branchId && sales.length > 0,
    queryFn: async () => {
      const ids = sales.map((s) => s.id);
      const { data, error } = await supabase
        .from("sale_items")
        .select("name_snapshot, quantity, total, sale_id")
        .in("sale_id", ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const completed = sales.filter((s) => s.status === "completed");
  const revenue = completed.reduce((s, x) => s + Number(x.total), 0);
  const avg = completed.length ? revenue / completed.length : 0;

  const top = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; total: number }>();
    for (const i of items) {
      const cur = map.get(i.name_snapshot) ?? { name: i.name_snapshot, qty: 0, total: 0 };
      cur.qty += Number(i.quantity);
      cur.total += Number(i.total);
      map.set(i.name_snapshot, cur);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [items]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label>Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Ventas</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{completed.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Ingresos</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{money(revenue)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Ticket promedio</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{money(avg)}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Más vendidos</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Piezas</TableHead>
                  <TableHead>Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.qty}</TableCell>
                    <TableCell>{money(t.total)}</TableCell>
                  </TableRow>
                ))}
                {!top.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Sin ventas en este periodo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ventas del periodo</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>#{s.folio}</TableCell>
                    <TableCell>{shortDate(s.created_at)}</TableCell>
                    <TableCell>{s.payment_method}</TableCell>
                    <TableCell>{money(s.total)}</TableCell>
                  </TableRow>
                ))}
                {!sales.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Sin ventas en este periodo.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
