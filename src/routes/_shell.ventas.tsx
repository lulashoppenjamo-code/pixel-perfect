import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_shell/ventas")({
  head: () => ({
    meta: [
      { title: "Punto de venta — Lula Shop OS" },
      { name: "description", content: "Cobra rápido: busca productos, arma el carrito y registra la venta con descuento de inventario." },
      { property: "og:title", content: "Punto de venta — Lula Shop OS" },
      { property: "og:description", content: "Cobra rápido: busca productos, arma el carrito y registra la venta con descuento de inventario." },
    ],
  }),
  component: VentasPage,
});

type CartLine = { product_id: string; name: string; unit_price: number; quantity: number };
type PaymentMethod = "cash" | "card" | "transfer" | "credit" | "mixed";

function VentasPage() {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerId, setCustomerId] = useState<string>("none");
  const [cashReceived, setCashReceived] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, price, emoji, tax_rate")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: session } = useQuery({
    queryKey: ["open-session", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id")
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
      .slice(0, 40);
  }, [products, search]);

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const tax = cart.reduce((s, l) => {
    const p = products.find((x) => x.id === l.product_id);
    return s + l.unit_price * l.quantity * Number(p?.tax_rate ?? 0);
  }, 0);
  const total = subtotal + tax;

  const add = (p: { id: string; name: string; price: number | string }) => {
    setCart((c) => {
      const found = c.find((l) => l.product_id === p.id);
      if (found) return c.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { product_id: p.id, name: p.name, unit_price: Number(p.price), quantity: 1 }];
    });
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Selecciona una sucursal");
      if (!cart.length) throw new Error("El carrito está vacío");
      const { data, error } = await supabase.rpc("create_sale", {
        _branch_id: branchId,
        _items: cart.map((l) => ({
          product_id: l.product_id,
          name: l.name,
          unit_price: l.unit_price,
          quantity: l.quantity,
          discount: 0,
        })),
        _payment_method: method,
        ...(customerId === "none" ? {} : { _customer_id: customerId }),
        ...(session?.id ? { _cash_session_id: session.id } : {}),
        _discount: 0,
        ...(method === "cash" && cashReceived ? { _cash_received: Number(cashReceived) } : {}),
      });
      if (error) throw error;
      return data as unknown as { folio: number; change_given: number | null };
    },
    onSuccess: (sale) => {
      toast.success(`Venta registrada · folio ${sale.folio}`);
      setCart([]);
      setCashReceived("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo cobrar"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
          <Input
            placeholder="Buscar por nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => add(p)}
              className="rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
            >
              <div className="text-2xl">{p.emoji ?? "📦"}</div>
              <div className="mt-1 line-clamp-2 text-sm font-medium">{p.name}</div>
              <div className="text-sm text-muted-foreground">{money(p.price)}</div>
            </button>
          ))}
          {!filtered.length && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              No hay productos. Agrégalos en la sección Productos.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Carrito</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!cart.length && <p className="text-sm text-muted-foreground">Agrega productos para cobrar.</p>}
          {cart.map((l) => (
            <div key={l.product_id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground">{money(l.unit_price)} c/u</div>
              </div>
              <Input
                type="number"
                min={1}
                className="w-16"
                value={l.quantity}
                onChange={(e) =>
                  setCart((c) =>
                    c.map((x) =>
                      x.product_id === l.product_id ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCart((c) => c.filter((x) => x.product_id !== l.product_id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Impuestos</span>
              <span>{money(tax)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Público general</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Método de pago</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Efectivo</SelectItem>
                <SelectItem value="card">Tarjeta</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
                <SelectItem value="credit">Crédito</SelectItem>
                <SelectItem value="mixed">Mixto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {method === "cash" && (
            <div className="space-y-2">
              <Label>Efectivo recibido</Label>
              <Input type="number" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
              {cashReceived && (
                <p className="text-sm text-muted-foreground">Cambio: {money(Math.max(Number(cashReceived) - total, 0))}</p>
              )}
            </div>
          )}

          <Button className="w-full" disabled={!cart.length || checkout.isPending} onClick={() => checkout.mutate()}>
            Cobrar {money(total)}
          </Button>
          {!session && <p className="text-xs text-muted-foreground">No hay caja abierta; la venta no se ligará a una sesión.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
