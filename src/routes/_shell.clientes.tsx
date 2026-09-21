/**
 * Clientes — LULA OS
 * Ruta: src/routes/_shell.clientes.tsx
 * Reemplaza el archivo existente completo.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_shell/clientes")({
  head: () => ({
    meta: [{ title: "Clientes — Lula OS" }],
  }),
  component: ClientesPage,
});

type Form = { id?: string; name: string; phone: string; email: string; notes: string };
const empty: Form = { name: "", phone: "", email: "", notes: "" };

function ClientesPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [search, setSearch] = useState("");

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
        .select("customer_id, total, status")
        .not("customer_id", "is", null)
        .eq("status", "completed");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = (() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const s of salesByCustomer) {
      if (!s.customer_id) continue;
      const cur = map.get(s.customer_id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(s.total);
      map.set(s.customer_id, cur);
    }
    return map;
  })();

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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Contactos, historial de compras y vínculo con el POS.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">
              {form.id ? "Editar cliente" : "Nuevo cliente"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Guardando…" : form.id ? "Actualizar" : "Crear"}
              </Button>
              {form.id && (
                <Button variant="outline" onClick={() => setForm(empty)}>
                  Cancelar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Listado</CardTitle>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Cargando...
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((c) => {
                  const st = stats.get(c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.email ?? "—"}</TableCell>
                      <TableCell className="text-right">{st?.count ?? 0}</TableCell>
                      <TableCell className="text-right font-medium">
                        {money(st?.total ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
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
    </div>
  );
}
