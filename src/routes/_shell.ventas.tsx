/**
 * Punto de Venta — LULA OS (estilo Zobaze)
 * Ruta: src/routes/_shell.ventas.tsx
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
  CreditCard,
  Banknote,
  Smartphone,
  User,
  AlertTriangle,
  X,
  Package,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TicketModal, type TicketData } from "@/components/pos/TicketModal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ventas")({
  head: () => ({
    meta: [{ title: "Punto de Venta — Lula OS" }],
  }),
  component: VentasPage,
});

type CartLine = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  discount: number;
  tax_rate: number;
  stock: number;
  sku?: string | null;
  barcode?: string | null;
  emoji?: string | null;
};

type PaymentMethod = "cash" | "card" | "transfer" | "credit" | "mixed";

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  tax_rate: number;
  emoji: string | null;
  category_id: string | null;
  stock: number;
};

function VentasPage() {
  const { branchId, branches } = useBranch();
  const { profile, user } = useAuth();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerId, setCustomerId] = useState<string>("none");
  const [cashReceived, setCashReceived] = useState("");
  const [ticketDiscount, setTicketDiscount] = useState("0");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

  // Settings
  const { data: settings } = useQuery({
    queryKey: ["settings-pos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("key, value");
      if (error) throw error;
      const parse = (k: string, fallback: unknown) => {
        const raw = (data ?? []).find((r) => r.key === k)?.value;
        if (raw === null || raw === undefined) return fallback;
        if (typeof raw === "boolean" || typeof raw === "number") return raw;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        return raw;
      };
      return {
        requireOpenCash: Boolean(parse("require_open_cash_session", true)),
        blockWithoutStock: Boolean(parse("block_sale_without_stock", true)),
        companyName: String(parse("company_name", "Lula Shop")),
        ticketFooter: String(parse("ticket_footer", "¡Gracias por su compra!")),
      };
    },
  });

  // Caja abierta
  const { data: openSession } = useQuery({
    queryKey: ["open-cash", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id, opened_at, opening_amount")
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Productos + stock de la sucursal
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["pos-products", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: prods, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode, price, tax_rate, emoji, category_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;

      const { data: inv } = await supabase
        .from("inventory")
        .select("product_id, stock")
        .eq("branch_id", branchId!);

      const stockMap = new Map((inv ?? []).map((i) => [i.product_id, Number(i.stock)]));

      return (prods ?? []).map((p) => ({
        ...p,
        price: Number(p.price),
        tax_rate: Number(p.tax_rate),
        stock: stockMap.get(p.id) ?? 0,
      })) as ProductRow[];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["pos-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["pos-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Filtro de productos
  const filtered = useMemo(() => {
    let list = products;
    if (categoryFilter !== "all") {
      list = list.filter((p) => p.category_id === categoryFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [products, search, categoryFilter]);

  // Totales
  const linesSubtotal = cart.reduce(
    (acc, l) => acc + l.unit_price * l.quantity - l.discount,
    0,
  );
  const linesTax = cart.reduce((acc, l) => {
    const base = l.unit_price * l.quantity - l.discount;
    return acc + base * (l.tax_rate || 0);
  }, 0);
  const disc = Number(ticketDiscount) || 0;
  const total = Math.max(0, linesSubtotal + linesTax - disc);
  const cashNum = Number(cashReceived) || 0;
  const change = method === "cash" ? Math.max(0, cashNum - total) : 0;

  // Añadir producto
  const addProduct = (p: ProductRow) => {
    if (settings?.blockWithoutStock && p.stock <= 0) {
      toast.error("Sin stock disponible");
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const line = { ...next[idx]! };
        if (settings?.blockWithoutStock && line.quantity + 1 > p.stock) {
          toast.error("Stock insuficiente");
          return prev;
        }
        line.quantity += 1;
        next[idx] = line;
        return next;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          unit_price: p.price,
          quantity: 1,
          discount: 0,
          tax_rate: p.tax_rate,
          stock: p.stock,
          sku: p.sku,
          barcode: p.barcode,
          emoji: p.emoji,
        },
      ];
    });
    setSearch("");
    searchRef.current?.focus();
  };

  // Escaneo / Enter en búsqueda
  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const q = search.trim();
    if (!q) return;
    // Prioridad: barcode exacto → sku exacto → primer resultado
    const byBarcode = products.find((p) => p.barcode === q);
    const bySku = products.find((p) => p.sku === q);
    const target = byBarcode ?? bySku ?? filtered[0];
    if (target) addProduct(target);
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.product_id !== productId) return l;
          const nextQty = l.quantity + delta;
          if (nextQty <= 0) return null;
          if (settings?.blockWithoutStock && nextQty > l.stock) {
            toast.error("Stock insuficiente");
            return l;
          }
          return { ...l, quantity: nextQty };
        })
        .filter(Boolean) as CartLine[],
    );
  };

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((l) => l.product_id !== productId));
  };

  // Cobrar
  const checkout = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!cart.length) throw new Error("Carrito vacío");
      if (settings?.requireOpenCash && !openSession) {
        throw new Error("Debes abrir caja antes de vender");
      }

      const items = cart.map((l) => ({
        product_id: l.product_id,
        variant_id: null,
        name: l.name,
        unit_price: l.unit_price,
        quantity: l.quantity,
        discount: l.discount,
      }));

      const { data, error } = await supabase.rpc("create_sale", {
        _branch_id: branchId,
        _items: items,
        _payment_method: method,
        _customer_id: customerId === "none" ? null : customerId,
        _cash_session_id: openSession?.id ?? null,
        _discount: disc,
        _cash_received: method === "cash" ? cashNum || total : null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (sale) => {
      const customerName =
        customerId !== "none"
          ? customers.find((c) => c.id === customerId)?.name
          : undefined;

      setTicket({
        companyName: settings?.companyName,
        branchName,
        folio: sale.folio,
        date: new Date().toLocaleString("es-MX"),
        cashierName: profile?.full_name ?? user?.email ?? "",
        customerName,
        paymentMethod: method,
        lines: cart.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount: l.discount,
          total: l.unit_price * l.quantity - l.discount,
        })),
        subtotal: linesSubtotal,
        tax: linesTax,
        discount: disc,
        total,
        cashReceived: method === "cash" ? cashNum || total : null,
        changeGiven: method === "cash" ? change : null,
        footer: settings?.ticketFooter,
      });
      setTicketOpen(true);
      setCart([]);
      setCashReceived("");
      setTicketDiscount("0");
      setCustomerId("none");
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["open-cash"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(`Venta #${sale.folio} registrada`);
      searchRef.current?.focus();
    },
    onError: (err: Error) => toast.error(err.message || "Error al cobrar"),
  });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const canSell = !settings?.requireOpenCash || !!openSession;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-0 lg:flex-row">
      {/* ========== IZQUIERDA: Catálogo ========== */}
      <div className="flex flex-1 flex-col overflow-hidden border-r bg-background">
        {/* Barra de búsqueda estilo Zobaze */}
        <div className="flex flex-col gap-3 border-b bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Buscar o escanear código de barras / SKU..."
                className="h-11 pl-10 text-base"
                autoComplete="off"
              />
            </div>
            {!canSell && (
              <Badge variant="destructive" className="shrink-0 gap-1">
                <AlertTriangle className="h-3 w-3" />
                Caja cerrada
              </Badge>
            )}
          </div>

          {/* Categorías */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Button
              size="sm"
              variant={categoryFilter === "all" ? "default" : "outline"}
              onClick={() => setCategoryFilter("all")}
              className="shrink-0"
            >
              Todos
            </Button>
            {categories.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={categoryFilter === c.id ? "default" : "outline"}
                onClick={() => setCategoryFilter(c.id)}
                className="shrink-0"
              >
                {c.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Grid de productos */}
        <ScrollArea className="flex-1 p-3 sm:p-4">
          {loadingProducts ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              Cargando productos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Package className="h-10 w-10 opacity-40" />
              <p>No se encontraron productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filtered.map((p) => {
                const outOfStock = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canSell || (settings?.blockWithoutStock && outOfStock)}
                    onClick={() => addProduct(p)}
                    className={cn(
                      "group relative flex flex-col items-start rounded-xl border bg-card p-3 text-left transition-all",
                      "hover:border-primary hover:shadow-md active:scale-[0.98]",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                      outOfStock && "opacity-60",
                    )}
                  >
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-xl">
                      {p.emoji || "📦"}
                    </div>
                    <p className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                    <p className="mt-1 text-base font-bold text-primary">{money(p.price)}</p>
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        outOfStock ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {outOfStock ? "Agotado" : `Stock: ${p.stock}`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ========== DERECHA: Carrito ========== */}
      <div className="flex w-full flex-col border-t bg-card lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[420px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="font-semibold">Carrito</span>
            {cart.length > 0 && (
              <Badge className="ml-1">{cart.reduce((a, l) => a + l.quantity, 0)}</Badge>
            )}
          </div>
          {cart.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive"
              onClick={() => setCart([])}
            >
              Vaciar
            </Button>
          )}
        </div>

        {/* Líneas del carrito */}
        <ScrollArea className="flex-1 px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
              <ShoppingCart className="h-8 w-8 opacity-30" />
              <p className="text-sm">Agrega productos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((l) => (
                <div
                  key={l.product_id}
                  className="flex items-start gap-2 rounded-lg border bg-background p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {money(l.unit_price)} c/u
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => updateQty(l.product_id, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-semibold">{l.quantity}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => updateQty(l.product_id, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="w-16 text-right">
                    <p className="text-sm font-semibold">
                      {money(l.unit_price * l.quantity - l.discount)}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeLine(l.product_id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Panel de cobro */}
        <div className="space-y-3 border-t bg-muted/30 p-4">
          {/* Cliente */}
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="Cliente (opcional)" />
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

          {/* Descuento ticket */}
          <div className="flex items-center gap-2">
            <span className="w-24 text-sm text-muted-foreground">Descuento $</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={ticketDiscount}
              onChange={(e) => setTicketDiscount(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Método de pago */}
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                { id: "cash", label: "Efectivo", icon: Banknote },
                { id: "card", label: "Tarjeta", icon: CreditCard },
                { id: "transfer", label: "Transf.", icon: Smartphone },
                { id: "credit", label: "Crédito", icon: User },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMethod(id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-all",
                  method === id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-primary/50",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {method === "cash" && (
            <div className="flex items-center gap-2">
              <span className="w-24 text-sm text-muted-foreground">Recibido $</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                placeholder={String(total.toFixed(2))}
                className="h-9"
              />
            </div>
          )}

          {/* Totales */}
          <div className="space-y-1 rounded-lg bg-background p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{money(linesSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Impuestos</span>
              <span>{money(linesTax)}</span>
            </div>
            {disc > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Descuento</span>
                <span>-{money(disc)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-lg font-bold">
              <span>Total</span>
              <span className="text-primary">{money(total)}</span>
            </div>
            {method === "cash" && cashNum > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cambio</span>
                <span className="font-semibold">{money(change)}</span>
              </div>
            )}
          </div>

          <Button
            size="lg"
            className="h-12 w-full text-base font-semibold"
            disabled={!canSell || cart.length === 0 || checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            {checkout.isPending ? "Procesando..." : `Cobrar ${money(total)}`}
          </Button>
        </div>
      </div>

      <TicketModal open={ticketOpen} onOpenChange={setTicketOpen} ticket={ticket} />
    </div>
  );
}