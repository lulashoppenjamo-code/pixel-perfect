/**
 * Gastos — LULA OS (FASE 5)
 * Requiere migración: tabla public.expenses
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/PageHeader";
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

export const Route = createFileRoute("/_shell/gastos")({
  head: () => ({
    meta: [{ title: "Gastos — Lula OS" }],
  }),
  component: GastosPage,
});

const CATEGORIES = [
  "Renta",
  "Servicios",
  "Nómina",
  "Transporte",
  "Mantenimiento",
  "Marketing",
  "Impuestos",
  "Otros",
];

type ExpenseForm = {
  concept: string;
  category: string;
  amount: string;
  expense_date: string;
  payment_method: string;
  notes: string;
};

const empty: ExpenseForm = {
  concept: "",
  category: "Otros",
  amount: "",
  expense_date: new Date().toISOString().slice(0, 10),
  payment_method: "cash",
  notes: "",
};

function GastosPage() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState<ExpenseForm>(empty);
  const [tableMissing, setTableMissing] = useState(false);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses" as "products")
        .select("*")
        .eq("branch_id", branchId!)
        .order("expense_date", { ascending: false })
        .limit(100);
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          setTableMissing(true);
          return [];
        }
        throw error;
      }
      setTableMissing(false);
      return (data ?? []) as {
        id: string;
        concept: string;
        category: string | null;
        amount: number;
        expense_date: string;
        payment_method: string;
        notes: string | null;
        created_at: string;
      }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!form.concept.trim()) throw new Error("Concepto requerido");
      const amount = Number(form.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Monto inválido");

      const { error } = await supabase.from("expenses" as "products").insert({
        concept: form.concept.trim(),
        category: form.category,
        amount,
        expense_date: form.expense_date,
        payment_method: form.payment_method,
        notes: form.notes.trim() || null,
        branch_id: branchId,
        created_by: user?.id ?? null,
      } as never);
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          throw new Error(
            "Tabla expenses no existe. Ejecuta la migración supabase/migrations/20260921_lula_os_evolution.sql",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Gasto registrado");
      setForm(empty);
      void qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalPeriod = expenses.reduce((a, e) => a + Number(e.amount), 0);

  return (
    <PageShell>
      <PageHeader
        icon={Receipt}
        title="Gastos"
        description="Registro de egresos por sucursal. Impacta reportes de utilidad."
      />

      {tableMissing && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="pt-4 text-sm">
            La tabla <code>expenses</code> aún no existe en Supabase. Ejecuta el SQL de
            migración en <code>supabase/migrations/20260921_lula_os_evolution.sql</code> y
            recarga.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Nuevo gasto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Concepto</Label>
              <Input
                value={form.concept}
                onChange={(e) => setForm((f) => ({ ...f, concept: e.target.value }))}
                placeholder="Ej. Luz del local"
              />
            </div>
            <div>
              <Label>Categoría</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Método de pago</Label>
              <Select
                value={form.payment_method}
                onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Efectivo</SelectItem>
                  <SelectItem value="card">Tarjeta</SelectItem>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nota</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <Button
              className="w-full gap-2"
              disabled={save.isPending || tableMissing}
              onClick={() => save.mutate()}
            >
              <Plus className="h-4 w-4" />
              {save.isPending ? "Guardando…" : "Registrar gasto"}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Historial</CardTitle>
            <span className="text-sm font-semibold text-destructive">
              Total listado: {money(totalPeriod)}
            </span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{shortDate(e.expense_date)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{e.concept}</p>
                          {e.notes && (
                            <p className="text-xs text-muted-foreground">{e.notes}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{e.category ?? "—"}</TableCell>
                      <TableCell>{e.payment_method}</TableCell>
                      <TableCell className="text-right font-medium">
                        {money(Number(e.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!expenses.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Sin gastos registrados
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
