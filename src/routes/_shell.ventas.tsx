

/**
 * Punto de Venta — LULA OS (estilo Zobaze)
 * Ruta: src/routes/_shell.ventas.tsx
 * FASE 2: POS mejorado — conserva todo lo existente y completa UX de venta real.
 * - Búsqueda nombre / SKU / barcode + Enter
 * - Cantidad editable (decimales)
 * - Descuento por línea y global
 * - Cambio de precio con permiso manager+
 * - Notas de venta (ticket)
 * - Métodos cash / card / transfer / credit / mixed
 * - Cambio en efectivo
 * - Historial reciente + reimpresión de ticket
 * - Ticket, vaciar carrito, bloqueo caja/stock
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
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
  History,
  Printer,
  Pencil,
  StickyNote,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TicketModal, type TicketData } from "@/components/pos/TicketModal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/ventas")({
  head: () => ({
    meta: [{ title: "Punto de Venta — Lula OS" }],
  }),
  component: VentasPage,
});

type CartLine = {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  unit_price: number;
  original_price: number;
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
  has_variants?: boolean;
};

type RecentSale = {
  id: string;
  folio: number;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  customer_id: string | null;
};

function VentasPage() {
  const { branchId, branches } = useBranch();
  const { profile, user, isManager } = useAuth();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerId, setCustomerId] = useState<string>("none");
  const [cashReceived, setCashReceived] = useState("");
  const [mixedCash, setMixedCash] = useState("");
  const [mixedCard, setMixedCard] = useState("");
  const [ticketDiscount, setTicketDiscount] = useState("0");
  const [saleNotes, setSaleNotes] = useState("");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editLineKey, setEditLineKey] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editDiscount, setEditDiscount] = useState("");

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";

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

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["pos-products", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: prods, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode, price, tax_rate, emoji, category_id, has_variants")
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
        has_variants: Boolean((p as { has_variants?: boolean }).has_variants),
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

  const { data: recentSales = [], refetch: refetchHistory } = useQuery({
    queryKey: ["pos-recent-sales", branchId],
    enabled: !!branchId && historyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, folio, total, payment_method, status, created_at, customer_id")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as RecentSale[];
    },
  });

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

  const addProduct = (p: ProductRow) => {
    if (settings?.blockWithoutStock && p.stock <= 0) {
      toast.error("Sin stock disponible");
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product_id === p.id && !l.variant_id);
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
          key: `${p.id}-${Date.now()}`,
          product_id: p.id,
          variant_id: null,
          name: p.name,
          unit_price: p.price,
          original_price: p.price,
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

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const byBarcode = products.find((p) => p.barcode === q);
    const bySku = products.find((p) => p.sku === q);
    const target = byBarcode ?? bySku ?? filtered[0];
    if (target) addProduct(target);
  };

  const updateQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          const nextQty = Math.round((l.quantity + delta) * 1000) / 1000;
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

  const setQtyDirect = (key: string, value: string) => {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) return;
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.key !== key) return l;
          if (n === 0) return null;
          if (settings?.blockWithoutStock && n > l.stock) {
            toast.error("Stock insuficiente");
            return l;
          }
          return { ...l, quantity: Math.round(n * 1000) / 1000 };
        })
        .filter(Boolean) as CartLine[],
    );
  };

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  };

  const openEditLine = (line: CartLine) => {
    setEditLineKey(line.key);
    setEditPrice(String(line.unit_price));
    setEditDiscount(String(line.discount));
  };

  const applyEditLine = () => {
    if (!editLineKey) return;
    const price = Number(editPrice);
    const discount = Number(editDiscount) || 0;
    if (Number.isNaN(price) || price < 0) {
      toast.error("Precio inválido");
      return;
    }
    if (discount < 0) {
      toast.error("Descuento inválido");
      return;
    }
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== editLineKey) return l;
        const nextPrice = isManager ? price : l.unit_price;
        if (!isManager && price !== l.unit_price) {
          toast.error("Sin permiso para cambiar precio");
        }
        return {
          ...l,
          unit_price: nextPrice,
          discount: Math.min(discount, nextPrice * l.quantity),
        };
      }),
    );
    setEditLineKey(null);
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!cart.length) throw new Error("Carrito vacío");
      if (settings?.requireOpenCash && !openSession) {
        throw new Error("Debes abrir caja antes de vender");
      }
      if (method === "cash" && cashNum > 0 && cashNum < total) {
        throw new Error("El efectivo recibido es menor al total");
      }
      if (method === "mixed") {
        const mc = Number(mixedCash) || 0;
        const mcard = Number(mixedCard) || 0;
        if (mc + mcard < total - 0.01) {
          throw new Error("La suma de pagos mixtos debe cubrir el total");
        }
      }
      if (method === "credit" && customerId === "none") {
        throw new Error("Selecciona un cliente para venta a crédito");
      }

      const items = cart.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
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
        _cash_received:
          method === "cash"
            ? cashNum || total
            : method === "mixed"
              ? Number(mixedCash) || null
              : null,
      });

      if (error) throw error;
      return data as { folio: number; id?: string };
    },
    onSuccess: (sale) => {
      const customerName =
        customerId !== "none"
          ? customers.find((c) => c.id === customerId)?.name
          : undefined;

      const paymentLabel =
        method === "mixed"
          ? `Mixto (Efectivo ${money(Number(mixedCash) || 0)} + Tarjeta ${money(Number(mixedCard) || 0)})`
          : method;

      setTicket({
        companyName: settings?.companyName,
        branchName,
        folio: sale.folio,
        date: new Date().toLocaleString("es-MX"),
        cashierName: profile?.full_name ?? user?.email ?? "",
        customerName,
        paymentMethod: paymentLabel,
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
        cashReceived:
          method === "cash"
            ? cashNum || total
            : method === "mixed"
              ? Number(mixedCash) || null
              : null,
        changeGiven: method === "cash" ? change : null,
        footer: saleNotes
          ? `${settings?.ticketFooter ?? ""}\nNotas: ${saleNotes}`.trim()
          : settings?.ticketFooter,
      });
      setTicketOpen(true);
      setCart([]);
      setCashReceived("");
      setMixedCash("");
      setMixedCard("");
      setTicketDiscount("0");
      setSaleNotes("");
      setCustomerId("none");
      setMethod("cash");
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["open-cash"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-recent-sales"] });
      toast.success(`Venta #${sale.folio} registrada`);
      searchRef.current?.focus();
    },
    onError: (err: Error) => toast.error(err.message || "Error al cobrar"),
  });

  const reprintSale = useMutation({
    mutationFn: async (saleId: string) => {
      const { data: sale, error } = await supabase
        .from("sales")
        .select(
          "id, folio, total, subtotal, tax, discount, payment_method, cash_received, change_given, created_at, customer_id, cashier_id",
        )
        .eq("id", saleId)
        .single();
      if (error) throw error;

      const { data: items, error: itemsErr } = await supabase
        .from("sale_items")
        .select("name_snapshot, quantity, unit_price, discount, total")
        .eq("sale_id", saleId);
      if (itemsErr) throw itemsErr;

      let customerName: string | undefined;
      if (sale.customer_id) {
        const { data: c } = await supabase
          .from("customers")
          .select("name")
          .eq("id", sale.customer_id)
          .maybeSingle();
        customerName = c?.name;
      }

      return { sale, items: items ?? [], customerName };
    },
    onSuccess: ({ sale, items, customerName }) => {
      setTicket({
        companyName: settings?.companyName,
        branchName,
        folio: sale.folio,
        date: new Date(sale.created_at).toLocaleString("es-MX"),
        cashierName: profile?.full_name ?? user?.email ?? "",
        customerName,
        paymentMethod: sale.payment_method,
        lines: items.map((l) => ({
          name: l.name_snapshot,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          discount: Number(l.discount),
          total: Number(l.total),
        })),
        subtotal: Number(sale.subtotal),
        tax: Number(sale.tax),
        discount: Number(sale.discount),
        total: Number(sale.total),
        cashReceived: sale.cash_received != null ? Number(sale.cash_received) : null,
        changeGiven: sale.change_given != null ? Number(sale.change_given) : null,
        footer: settings?.ticketFooter,
      });
      setHistoryOpen(false);
      setTicketOpen(true);
    },
    onError: (err: Error) => toast.error(err.message || "No se pudo reimprimir"),
  });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const canSell = !settings?.requireOpenCash || !!openSession;

  return (
    <div className="flex h-[calc(100dvh-4.5rem)] flex-col bg-[#f4f6fb] lg:h-screen lg:flex-row">
      {/* ═══ IZQUIERDA: Counter (réplica Zobaze) ═══ */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar azul tipo app */}
        <div className="flex items-center justify-between bg-[#4169e2] px-3 py-2.5 text-white sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">
              {branches.find((b) => b.id === branchId)?.name ?? "Counter"}
            </p>
            <p className="text-[10px] opacity-80">
              {canSell ? "Listo para vender" : "Caja cerrada"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white hover:bg-white/15"
              title="Historial"
              onClick={() => {
                setHistoryOpen(true);
                void refetchHistory();
              }}
            >
              <History className="h-4 w-4" />
            </Button>
            {!canSell && (
              <span className="rounded-full bg-red-500/90 px-2.5 py-1 text-[10px] font-bold">
                Caja cerrada
              </span>
            )}
          </div>
        </div>

        {/* Search Zobaze */}
        <div className="border-b border-[#e2e8f0] bg-white px-3 py-2.5 sm:px-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b8]" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="What do you want to sell?"
              className="h-11 rounded-full border-[#e2e8f0] bg-[#f4f6fb] pl-10 text-[15px] shadow-none focus-visible:ring-[#4169e2]/30"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto border-b border-[#e2e8f0] bg-white px-3 py-2.5 scrollbar-none sm:px-4">
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={
              "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-bold transition-colors " +
              (categoryFilter === "all"
                ? "bg-[#4169e2] text-white shadow-sm"
                : "bg-[#eef1f8] text-[#4b5563]")
            }
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryFilter(c.id)}
              className={
                "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-bold transition-colors " +
                (categoryFilter === c.id
                  ? "bg-[#4169e2] text-white shadow-sm"
                  : "bg-[#eef1f8] text-[#4b5563]")
              }
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <ScrollArea className="flex-1 bg-[#f4f6fb] p-3 sm:p-4">
          {loadingProducts ? (
            <div className="py-16 text-center text-sm text-[#9aa3b8]">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-[#9aa3b8]">
              <Package className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">No items found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {filtered.map((p) => {
                const outOfStock = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canSell || (settings?.blockWithoutStock && outOfStock)}
                    onClick={() => addProduct(p)}
                    className={
                      "zb-product-card group relative flex flex-col items-center p-3 text-center disabled:cursor-not-allowed disabled:opacity-45"
                    }
                  >
                    {outOfStock && (
                      <span className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-[#e5484d] px-2 py-0.5 text-[10px] font-bold text-white">
                        Agotado
                      </span>
                    )}
                    <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8eefc] text-3xl">
                      {p.emoji || "📦"}
                    </div>
                    <p className="line-clamp-2 min-h-[2.25rem] text-[13px] font-semibold leading-tight text-[#1a1d26]">
                      {p.name}
                    </p>
                    <p className="mt-1 text-base font-bold text-[#4169e2]">{money(p.price)}</p>
                    <p
                      className={
                        "mt-0.5 text-[11px] " +
                        (outOfStock ? "font-semibold text-[#e5484d]" : "text-[#9aa3b8]")
                      }
                    >
                      {outOfStock ? "Out of stock" : `Available: ${p.stock}`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ═══ DERECHA: Cart (réplica Zobaze) ═══ */}
      <div className="flex w-full flex-col border-t border-[#e2e8f0] bg-white lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[400px]">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8eefc]">
              <ShoppingCart className="h-4 w-4 text-[#4169e2]" />
            </div>
            <span className="font-bold text-[#1a1d26]">Order</span>
            {cart.length > 0 && (
              <span className="rounded-full bg-[#4169e2] px-2 py-0.5 text-[11px] font-bold text-white">
                {cart.reduce((a, l) => a + l.quantity, 0)}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              className="text-xs font-semibold text-[#e5484d]"
              onClick={() => setCart([])}
            >
              Clear
            </button>
          )}
        </div>

        <ScrollArea className="flex-1 px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-2 text-[#9aa3b8]">
              <ShoppingCart className="h-9 w-9 opacity-25" />
              <p className="text-sm">Tap items to add</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((l) => (
                <div
                  key={l.key}
                  className="flex items-start gap-2 rounded-xl border border-[#e8ecf4] bg-[#fafbfe] p-2.5"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8eefc] text-base">
                    {l.emoji || "📦"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1a1d26]">{l.name}</p>
                    <p className="text-[11px] text-[#9aa3b8]">
                      {money(l.unit_price)} × {l.quantity}
                      {l.discount > 0 && (
                        <span className="ml-1 text-[#e5484d]">−{money(l.discount)}</span>
                      )}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 rounded-lg border-[#e2e8f0]"
                        onClick={() => updateQty(l.key, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min="0.001"
                        step="any"
                        value={l.quantity}
                        onChange={(e) => setQtyDirect(l.key, e.target.value)}
                        className="h-7 w-14 rounded-lg border-[#e2e8f0] px-1 text-center text-sm"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 rounded-lg border-[#e2e8f0]"
                        onClick={() => updateQty(l.key, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <button
                        type="button"
                        className="ml-auto text-[#9aa3b8] hover:text-[#4169e2]"
                        onClick={() => openEditLine(l)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="text-[#9aa3b8] hover:text-[#e5484d]"
                        onClick={() => removeLine(l.key)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-[#1a1d26]">
                    {money(l.unit_price * l.quantity - l.discount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Totals + pay — bloque fijo estilo Zobaze */}
        <div className="space-y-3 border-t border-[#e2e8f0] bg-white p-4">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-[#6b7280]">
              <span>Subtotal</span>
              <span>{money(linesSubtotal)}</span>
            </div>
            {disc > 0 && (
              <div className="flex justify-between text-[#e5484d]">
                <span>Discount</span>
                <span>−{money(disc)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#6b7280]">
              <span>Tax</span>
              <span>{money(linesTax)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[#e2e8f0] pt-2">
              <span className="text-base font-bold text-[#1a1d26]">Total</span>
              <span className="text-xl font-black text-[#4169e2]">{money(total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {(
              [
                { id: "cash" as const, label: "Cash", icon: Banknote },
                { id: "card" as const, label: "Card", icon: CreditCard },
                { id: "transfer" as const, label: "UPI", icon: Smartphone },
                { id: "credit" as const, label: "Credit", icon: User },
                { id: "mixed" as const, label: "Split", icon: CreditCard },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMethod(id)}
                className={
                  "flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] font-semibold transition-all " +
                  (method === id
                    ? "border-[#4169e2] bg-[#4169e2] text-white"
                    : "border-[#e8ecf4] bg-[#fafbfe] text-[#4b5563]")
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {method === "cash" && (
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs font-medium text-[#6b7280]">Received</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                placeholder={String(total.toFixed(2))}
                className="h-10 rounded-xl border-[#e2e8f0]"
              />
            </div>
          )}

          {method === "mixed" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[11px] text-[#6b7280]">Cash</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={mixedCash}
                  onChange={(e) => setMixedCash(e.target.value)}
                  className="h-10 rounded-xl border-[#e2e8f0]"
                />
              </div>
              <div>
                <span className="text-[11px] text-[#6b7280]">Card</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={mixedCard}
                  onChange={(e) => setMixedCard(e.target.value)}
                  className="h-10 rounded-xl border-[#e2e8f0]"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="h-10 flex-1 rounded-xl border-[#e2e8f0] text-sm">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Walk-in</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {method === "cash" && cashNum > 0 && cashNum >= total && (
            <p className="text-center text-sm font-semibold text-[#30a46c]">
              Change: {money(cashNum - total)}
            </p>
          )}

          <button
            type="button"
            disabled={!canSell || cart.length === 0 || checkout.isPending}
            onClick={() => checkout.mutate()}
            className="zb-pay-btn flex h-12 w-full items-center justify-center gap-2 text-base disabled:opacity-50"
          >
            {checkout.isPending ? "Processing…" : `CHARGE  ${money(total)}`}
          </button>
        </div>
      </div>

      {/* Dialogs originales se mantienen abajo si existen en el código residual */}

      <Dialog open={!!editLineKey} onOpenChange={(o) => !o && setEditLineKey(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar línea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm text-muted-foreground">
                Precio unitario {isManager ? "" : "(solo lectura)"}
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                disabled={!isManager}
                className="mt-1"
              />
              {!isManager && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Solo managers pueden modificar el precio.
                </p>
              )}
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Descuento de línea $</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editDiscount}
                onChange={(e) => setEditDiscount(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineKey(null)}>
              Cancelar
            </Button>
            <Button onClick={applyEditLine}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Historial reciente + reimpresión */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ventas recientes</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-2 pr-2">
              {recentSales.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Sin ventas recientes
                </p>
              ) : (
                recentSales.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        Folio #{s.folio}{" "}
                        <Badge variant="outline" className="ml-1 text-xs">
                          {s.status}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("es-MX")} ·{" "}
                        {s.payment_method} · {money(Number(s.total))}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reprintSale.isPending}
                      onClick={() => reprintSale.mutate(s.id)}
                    >
                      <Printer className="mr-1 h-3.5 w-3.5" />
                      Ticket
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <TicketModal open={ticketOpen} onOpenChange={setTicketOpen} ticket={ticket} />
    </div>
  );
}
 