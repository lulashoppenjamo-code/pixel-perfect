/**
 * Compras y proveedores — FASE 3
 * Ruta: src/routes/_shell.compras.tsx (REEMPLAZAR)
 *
 * - Órdenes de compra
 * - Recepción total y parcial
 * - Actualización de costo promedio (vía RPC)
 * - Proveedores
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_shell/compras")({
  head: () => ({
    meta: [
      { title: "Compras y proveedores — Lula Shop OS" },
      {
        name: "description",
        content: "Órdenes de compra, recepción parcial y proveedores.",
      },
      { property: "og:title", content: "Compras y proveedores — Lula Shop OS" },
    ],
  }),
  component: ComprasPage,
});

type Line = { product_id: string; name: string; quantity: number; unit_cost: number };

type PurchaseRow = {
  id: string;
  status: string;
  total: number;
  created_at: string;
  received_at: string | null;
  supplier_id: string | null;
  suppliers: { name: string } | null;
};

type PurchaseItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  received_quantity: number;
  products: { name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  ordered: "Ordenada",
  received: "Recibida",
  cancelled: "Cancelada",
};

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

  // Recepción
  const [recvPurchase, setRecvPurchase] = useState<PurchaseRow | null>(null);
  const [recvItems, setRecvItems] = useState<PurchaseItemRow[]>([]);
  const [recvQty, setRecvQty] = useState<Record<string, number>>({});

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-min-cost"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, cost")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ["purchases", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, status, total, created_at, received_at, supplier_id, suppliers(name)")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PurchaseRow[];
    },
  });

  const orderTotal = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0),
    [lines],
  );

  const addLine = () => {
    const p = products.find((x) => x.id === pick);
    if (!p) return;
    const q = Math.max(1, Number(qty) || 1);
    const c = Math.max(0, Number(cost) || Number(p.cost) || 0);
    setLines((prev) => {
      const found = prev.find((l) => l.product_id === p.id);
      if (found) {
        return prev.map((l) =>
          l.product_id === p.id
            ? { ...l, quantity: l.quantity + q, unit_cost: c }
            : l,
        );
      }
      return [...prev, { product_id: p.id, name: p.name, quantity: q, unit_cost: c }];
    });
    setPick("");
    setQty("1");
  };

  const createPurchase = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Selecciona sucursal");
      if (!lines.length) throw new Error("Agrega líneas");
      const { data: pur, error } = await supabase
        .from("purchases")
        .insert({
          branch_id: branchId,
          supplier_id: supplierId === "none" ? null : supplierId,
          status: "ordered",
          total: orderTotal,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: itemsErr } = await supabase.from("purchase_items").insert(
        lines.map((l) => ({
          purchase_id: pur.id,
          product_id: l.product_id,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          received_quantity: 0,
        })),
      );
      if (itemsErr) throw itemsErr;
      return pur;
    },
    onSuccess: () => {
      toast.success("Orden de compra creada");
      setLines([]);
      setSupplierId("none");
      void qc.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSupplier = useMutation({
    mutationFn: async () => {
      if (!sup.name.trim()) throw new Error("Nombre requerido");
      const { error } = await supabase.from("suppliers").insert({
        name: sup.name.trim(),
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
    onError: (e: Error) => toast.error(e.message),
  });

  const openReceive = async (p: PurchaseRow) => {
    if (p.status === "received" || p.status === "cancelled") {
      toast.error("Esta compra no se puede recibir");
      return;
    }
    const { data, error } = await supabase
      .from("purchase_items")
      .select("id, product_id, quantity, unit_cost, received_quantity, products(name)")
      .eq("purchase_id", p.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const items = (data ?? []) as unknown as PurchaseItemRow[];
    setRecvPurchase(p);
    setRecvItems(items);
    const qtyMap: Record<string, number> = {};
    for (const it of items) {
      const pending = Number(it.quantity) - Number(it.received_quantity || 0);
      qtyMap[it.product_id] = pending > 0 ? pending : 0;
    }
    setRecvQty(qtyMap);
  };

  const receivePartial = useMutation({
    mutationFn: async () => {
      if (!recvPurchase) throw new Error("Sin compra");
      const payload = recvItems
        .filter((it) => (recvQty[it.product_id] ?? 0) > 0)
        .map((it) => ({
          product_id: it.product_id,
          quantity: Math.min(
            recvQty[it.product_id] ?? 0,
            Number(it.quantity) - Number(it.received_quantity || 0),
          ),
        }))
        .filter((x) => x.quantity > 0);

      if (!payload.length) throw new Error("Indica cantidades a recibir");

      const { error } = await supabase.rpc("receive_purchase_partial", {
        _purchase_id: recvPurchase.id,
        _items: payload,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Recepción registrada (inventario y costos actualizados)");
      setRecvPurchase(null);
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["products-min-cost"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const receiveAll = useMutation({
    mutationFn: async (purchaseId: string) => {
      const { error } = await supabase.rpc("receive_purchase", {
        _purchase_id: purchaseId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Compra recibida por completo");
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = (s: string) => {
    if (s === "received") return <Badge variant="secondary">{STATUS_LABEL[s]}</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">{STATUS_LABEL[s]}</Badge>;
    if (s === "ordered") return <Badge>{STATUS_LABEL[s]}</Badge>;
    return <Badge variant="outline">{STATUS_LABEL[s] ?? s}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Compras</h1>
        <p className="text-sm text-muted-foreground">
          Órdenes, recepción total/parcial y proveedores. El costo del producto se recalcula al recibir.
        </p>
      </div>

      <Tabs defaultValue="ordenes">
        <TabsList>
          <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
          <TabsTrigger value="nueva">Nueva orden</TabsTrigger>
          <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
        </TabsList>

        <TabsContent value="ordenes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Órdenes de compra</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{shortDate(p.created_at)}</TableCell>
                      <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                      <TableCell>{money(Number(p.total))}</TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="space-x-2">
                        {(p.status === "ordered" || p.status === "draft") && isManager && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void openReceive(p)}>
                              Recepción parcial
                            </Button>
                            <Button
                              size="sm"
                              disabled={receiveAll.isPending}
                              onClick={() => receiveAll.mutate(p.id)}
                            >
                              Recibir todo
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && !purchases.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No hay órdenes todavía.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nueva" className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Líneas de la orden</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Select
                  value={pick}
                  onValueChange={(v) => {
                    setPick(v);
                    const p = products.find((x) => x.id === v);
                    if (p) setCost(String(p.cost ?? 0));
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Producto…" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="w-20"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="Cant."
                />
                <Input
                  type="number"
                  className="w-28"
                  min={0}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Costo"
                />
                <Button type="button" size="icon" variant="secondary" onClick={addLine} disabled={!pick}>
                  <Plus className="size-4" />
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.product_id}>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right">{l.quantity}</TableCell>
                      <TableCell className="text-right">{money(l.unit_cost)}</TableCell>
                      <TableCell className="text-right">{money(l.quantity * l.unit_cost)}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setLines((prev) => prev.filter((x) => x.product_id !== l.product_id))}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!lines.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        Agrega productos a la orden.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>{money(orderTotal)}</span>
              </div>
              <Button
                className="w-full"
                disabled={!isManager || !lines.length || createPurchase.isPending}
                onClick={() => createPurchase.mutate()}
              >
                {createPurchase.isPending ? "Creando…" : "Crear orden"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proveedores" className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proveedores</CardTitle>
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
              <CardTitle className="text-base">Nuevo proveedor</CardTitle>
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
              <Button
                className="w-full"
                disabled={!isManager || !sup.name || saveSupplier.isPending}
                onClick={() => saveSupplier.mutate()}
              >
                Guardar
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog recepción parcial */}
      <Dialog open={!!recvPurchase} onOpenChange={(o) => !o && setRecvPurchase(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recepción parcial</DialogTitle>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {recvItems.map((it) => {
              const pending = Number(it.quantity) - Number(it.received_quantity || 0);
              return (
                <div key={it.id} className="flex items-center justify-between gap-2 rounded border p-2">
                  <div>
                    <div className="font-medium">{it.products?.name ?? it.product_id}</div>
                    <div className="text-xs text-muted-foreground">
                      Pedido {it.quantity} · Recibido {it.received_quantity || 0} · Pendiente {pending} ·{" "}
                      {money(Number(it.unit_cost))} c/u
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={pending}
                    className="h-8 w-20"
                    disabled={pending <= 0}
                    value={recvQty[it.product_id] ?? 0}
                    onChange={(e) =>
                      setRecvQty((q) => ({
                        ...q,
                        [it.product_id]: Math.min(pending, Math.max(0, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecvPurchase(null)}>
              Cancelar
            </Button>
            <Button disabled={receivePartial.isPending} onClick={() => receivePartial.mutate()}>
              {receivePartial.isPending ? "Recibiendo…" : "Confirmar recepción"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
