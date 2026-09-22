/**
 * Clientes — LULA OS (FASE 4)
 * CRUD + historial + saldo crédito + abonos
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, Search, Wallet, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_shell/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Lula OS" }],
  }),
  component: () => (
    <RequireNavAccess navKey="clientes">
      <ClientesPage />
    </RequireNavAccess>
  ),
});

type Form = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  address: string;
};
const empty: Form = { name: "", phone: "", email: "", notes: "", address: "" };

function ClientesPage() {
  const { isManager, user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [search, setSearch] = useState("");
  const [payCustomerId, setPayCustomerId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payNotes, setPayNotes] = useState("");

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: salesByCustomer = [] } = useQuery({
    queryKey: ["customer-sales-agg"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("customer_id, total, status, payment_method, created_at")
        .not("customer_id", "is", null)
        .in("status", ["completed", "partially_refunded"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: creditPayments = [] } = useQuery({
    queryKey: ["credit-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_payments")
        .select("customer_id, amount");
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          return [];
        }
        throw error;
      }
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const map = new Map<
      string,
      { count: number; total: number; credit: number; last: string | null }
    >();
    for (const s of salesByCustomer) {
      if (!s.customer_id) continue;
      const cur = map.get(s.customer_id) ?? {
        count: 0,
        total: 0,
        credit: 0,
        last: null,
      };
      cur.count += 1;
      cur.total += Number(s.total);
      if (s.payment_method === "credit") {
        cur.credit += Number(s.total);
      }
      if (!cur.last || s.created_at > cur.last) cur.last = s.created_at;
      map.set(s.customer_id, cur);
    }
    const paid = new Map<string, number>();
    for (const p of creditPayments) {
      paid.set(p.customer_id, (paid.get(p.customer_id) ?? 0) + Number(p.amount));
    }
    for (const [, st] of map) {
      /* balance applied below per customer */
    }
    for (const [id, st] of map) {
      st.credit = Math.max(0, st.credit - (paid.get(id) ?? 0));
    }
    return map;
  }, [salesByCustomer, creditPayments]);

  const filtered = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Nombre requerido");
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        address: form.address.trim() || null,
      };

      if (form.id) {
        const { error } = await supabase.from("customers").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Cliente actualizado" : "Cliente creado");
      setForm(empty);
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente eliminado");
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const registerPayment = useMutation({
    mutationFn: async () => {
      if (!payCustomerId) throw new Error("Sin cliente");
      const amount = Number(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
      const { error } = await supabase.from("credit_payments").insert({
        customer_id: payCustomerId,
        amount,
        payment_method: payMethod,
        notes: payNotes.trim() || null,
        branch_id: branchId,
        created_by: user?.id ?? null,
      });
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          throw new Error(
            "Tabla credit_payments no existe. Ejecuta la migración SQL en supabase/migrations/",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Abono registrado");
      setPayCustomerId(null);
      setPayAmount("");
      setPayNotes("");
      void qc.invalidateQueries({ queryKey: ["credit-payments"] });
      void qc.invalidateQueries({ queryKey: ["customer-sales-agg"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell>
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Contactos, historial de compras, saldo a crédito y abonos."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">
              {form.id ? "Editar cliente" : "Nuevo cliente"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <Label>Correo</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <Label>Dirección</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Opcional (requiere migración)"
              />
            </div>
            <div>
              <Label>Notas</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              {form.id && (
                <Button variant="outline" className="flex-1" onClick={() => setForm(empty)}>
                  Cancelar
                </Button>
              )}
              <Button
                className="flex-1"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Guardando…" : form.id ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Listado</CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-7"
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Saldo crédito</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const st = stats.get(c.id);
                  const balance = st?.credit ?? 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                      <TableCell className="text-right">{st?.count ?? 0}</TableCell>
                      <TableCell className="text-right font-medium">
                        {money(st?.total ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {balance > 0 ? (
                          <Badge variant="destructive">{money(balance)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">$0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {balance > 0 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Registrar abono"
                              onClick={() => {
                                setPayCustomerId(c.id);
                                setPayAmount(String(balance));
                              }}
                            >
                              <Wallet className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() =>
                              setForm({
                                id: c.id,
                                name: c.name,
                                phone: c.phone ?? "",
                                email: c.email ?? "",
                                notes: c.notes ?? "",
                                address:
                                  ((c as { address?: string | null }).address as string) ??
                                  "",
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isManager && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              onClick={() => remove.mutate(c.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Sin clientes.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!payCustomerId} onOpenChange={(o) => !o && setPayCustomerId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar abono</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Monto</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Método</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
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
              <Label>Notas</Label>
              <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayCustomerId(null)}>
              Cancelar
            </Button>
            <Button
              disabled={registerPayment.isPending}
              onClick={() => registerPayment.mutate()}
            >
              {registerPayment.isPending ? "Guardando…" : "Abonar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
