// ============================================================================
// RUTA: src/routes/_shell.compras.tsx
// Copia TODO lo de abajo (sin estas 4 líneas de comentario) a: src/routes/_shell.compras.tsx
// ============================================================================

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/PageHeader";

export const Route = createFileRoute("/_shell/compras")({
  head: () => ({
    meta: [
      { title: "Compras y proveedores — Lula Shop OS" },
      { name: "description", content: "Administra proveedores y órdenes de compra; al recibirlas el inventario se actualiza solo." },
      { property: "og:title", content: "Compras y proveedores — Lula Shop OS" },
      { property: "og:description", content: "Administra proveedores y órdenes de compra; al recibirlas el inventario se actualiza solo." },
    ],
  }),
  component: ComprasPage,
});

type Line = { product_id: string; name: string; quantity: number; unit_cost: number };

function ComprasPage() {
  const { isManager, user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState("none");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("0");
  const [sup, setSup] = useState({ name: "", phone: "", email: "" });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, cost").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, status, total, created_at, received_at, suppliers(name)")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);

  const createPurchase = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Selecciona una sucursal");
      if (!lines.length) throw new Error("Agrega al menos un producto");
      const { data, error } = await supabase
        .from("purchases")
        .insert({
          branch_id: branchId,
          supplier_id: supplierId === "none" ? null : supplierId,
          status: "ordered",
          total,
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("purchase_items").insert(
        lines.map((l) => ({
          purchase_id: data.id,
          product_id: l.product_id,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
        })),
      );
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Orden de compra creada");
      setLines([]);
      void qc.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo crear"),
  });

  const receive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("receive_purchase", { _purchase_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Compra recibida, inventario actualizado");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo recibir"),
  });

  const saveSupplier = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("suppliers").insert({
        name: sup.name,
        phone: sup.phone || null,
        email: sup.email || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Proveedor guardado");
      setSup({ name: "", phone: "", email: "" });
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <PageShell>
      <PageHeader
        icon={Truck}
        title="Compras"
        description="Órdenes de compra y proveedores. Al recibir, el inventario se actualiza."
      />
    <Tabs defaultValue="ordenes" className="space-y-4">
      <TabsList>
        <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
        <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
      </TabsList>

      <TabsContent value="ordenes" className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Órdenes de compra</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{shortDate(p.created_at)}</TableCell>
                    <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                    <TableCell>{money(p.total)}</TableCell>
                    <TableCell>{p.status}</TableCell>
                    <TableCell className="text-right">
                      {isManager && p.status !== "received" && p.status !== "cancelled" && (
                        <Button size="sm" variant="outline" onClick={() => receive.mutate(p.id)}>
                          Recibir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!purchases.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Sin órdenes de compra.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nueva orden</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isManager && <p className="text-sm text-muted-foreground">Tu rol no puede crear compras.</p>}
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proveedor</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Producto</Label>
              <Select
                value={pick}
                onValueChange={(v) => {
                  setPick(v);
                  setCost(String(products.find((p) => p.id === v)?.cost ?? 0));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elige un producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Cantidad</Label>
                <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Costo unitario</Label>
                <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={!pick}
              onClick={() => {
                const p = products.find((x) => x.id === pick)!;
                setLines((l) => [...l, { product_id: p.id, name: p.name, quantity: Number(qty), unit_cost: Number(cost) }]);
                setPick("");
              }}
            >
              <Plus className="size-4" /> Agregar partida
            </Button>

            {lines.map((l, i) => (
              <div key={`${l.product_id}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {l.quantity} × {l.name}
                </span>
                <span>{money(l.quantity * l.unit_cost)}</span>
                <Button variant="ghost" size="icon" onClick={() => setLines((c) => c.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}

            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
            <Button className="w-full" disabled={!isManager || !lines.length} onClick={() => createPurchase.mutate()}>
              Crear orden
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="proveedores" className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Proveedores</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Correo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.phone ?? "—"}</TableCell>
                    <TableCell>{s.email ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!suppliers.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Aún no hay proveedores.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nuevo proveedor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Correo</Label>
              <Input value={sup.email} onChange={(e) => setSup({ ...sup, email: e.target.value })} />
            </div>
            <Button className="w-full" disabled={!isManager || !sup.name} onClick={() => saveSupplier.mutate()}>
              Guardar
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
    </PageShell>
  );
}
