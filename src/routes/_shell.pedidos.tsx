import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Store, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
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
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_shell/pedidos")({
  head: () => ({
    meta: [{ title: "Pedidos online — Lula OS" }],
  }),
  component: PedidosPage,
});

type OrderRow = {
  id: string;
  status: string;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  created_at: string;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

function PedidosPage() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [pickProduct, setPickProduct] = useState("");
  const [pickQty, setPickQty] = useState("1");
  const [lines, setLines] = useState<
    { product_id: string; name: string; unit_price: number; quantity: number }[]
  >([]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["online-orders", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_orders")
        .select(
          "id, status, total, customer_name, customer_phone, delivery_address, created_at, notes",
        )
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const addLine = () => {
    const p = products.find((x) => x.id === pickProduct);
    if (!p) return;
    const q = Math.max(1, Number(pickQty) || 1);
    setLines((prev) => {
      const found = prev.find((l) => l.product_id === p.id);
      if (found) {
        return prev.map((l) =>
          l.product_id === p.id ? { ...l, quantity: l.quantity + q } : l,
        );
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          unit_price: Number(p.price),
          quantity: q,
        },
      ];
    });
    setPickProduct("");
    setPickQty("1");
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!lines.length) throw new Error("Agrega productos");
      const items = lines.map((l) => ({
        product_id: l.product_id,
        name: l.name,
        unit_price: l.unit_price,
        quantity: l.quantity,
      }));
      const { data, error } = await supabase.rpc("create_online_order", {
        _branch_id: branchId,
        _items: items,
        ...(customerName ? { _customer_name: customerName } : {}),
        ...(customerPhone ? { _customer_phone: customerPhone } : {}),
        ...(address ? { _delivery_address: address } : {}),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Pedido creado (stock reservado)");
      setCreateOpen(false);
      setLines([]);
      setCustomerName("");
      setCustomerPhone("");
      setAddress("");
      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fulfill = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("fulfill_online_order", { _order_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido entregado — stock descontado");
      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_online_order", { _order_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido cancelado — reserva liberada");
      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = (s: string) => {
    const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "default",
      confirmed: "secondary",
      preparing: "secondary",
      ready: "outline",
      delivered: "secondary",
      cancelled: "destructive",
    };
    return <Badge variant={map[s] ?? "outline"}>{STATUS_LABEL[s] ?? s}</Badge>;
  };

  const orderTotal = lines.reduce((a, l) => a + l.unit_price * l.quantity, 0);

  return (
    <PageShell>
      <PageHeader
        icon={Store}
        title="Pedidos online"
        description="Mismo catálogo e inventario. Reserva stock al crear y descuenta al entregar."
        action={
          <Button disabled={!isManager} onClick={() => setCreateOpen(true)}>
            <Store className="mr-2 h-4 w-4" />
            Nuevo pedido
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Órdenes recientes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
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
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {shortDate(o.created_at)}
                  </TableCell>
                  <TableCell className="font-medium">{o.customer_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{o.customer_phone ?? "—"}</TableCell>
                  <TableCell className="font-medium">{money(Number(o.total))}</TableCell>
                  <TableCell>{statusBadge(o.status)}</TableCell>
                  <TableCell className="text-right">
                    {o.status !== "delivered" && o.status !== "cancelled" && isManager && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={fulfill.isPending}
                          onClick={() => fulfill.mutate(o.id)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Entregar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(o.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Aún no hay pedidos online.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo pedido online</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección de entrega</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            <div className="flex gap-2">
              <Select value={pickProduct} onValueChange={setPickProduct}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {money(Number(p.price))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-20"
                type="number"
                min="1"
                value={pickQty}
                onChange={(e) => setPickQty(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={addLine}>
                +
              </Button>
            </div>

            <ul className="space-y-1 text-sm">
              {lines.map((l) => (
                <li key={l.product_id} className="flex justify-between rounded border px-2 py-1">
                  <span>
                    {l.quantity}× {l.name}
                  </span>
                  <span>{money(l.unit_price * l.quantity)}</span>
                </li>
              ))}
            </ul>
            {lines.length > 0 && (
              <p className="text-right font-semibold">Total {money(orderTotal)}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={createOrder.isPending || !lines.length} onClick={() => createOrder.mutate()}>
              {createOrder.isPending ? "Creando…" : "Crear pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
