import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star, ShieldCheck, Truck, Package, MessageCircle } from "lucide-react";

import { StoreHeader } from "@/components/store/StoreHeader";
import { StoreProductCard } from "@/components/store/StoreProductCard";
import { StoreCartSheet } from "@/components/store/StoreCartSheet";
import {
  STORE_CATEGORIES,
  type StoreCategory,
  type StoreProduct,
} from "@/lib/store/demoCatalog";
import {
  addToCart,
  clearCart,
  getCartItems,
  getCartCount,
  getCartTotal,
  removeFromCart,
  setCartQuantity,
  subscribeCart,
  type CartItem,
} from "@/lib/store/cart";
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";
import {
  loadStoreConfig,
  subscribeStoreConfig,
  type StoreConfig,
} from "@/lib/store/storeConfig";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop — Tienda en línea profesional" },
      {
        name: "description",
        content:
          "Compra material profesional para uñas. Inventario en tiempo real, envíos a todo México.",
      },
    ],
  }),
  component: TiendaPage,
});

function mapInventoryToStoreProducts(
  rows: SharedInventoryRow[],
): (StoreProduct & { stock: number })[] {
  const byProduct = new Map<
    string,
    {
      id: string;
      name: string;
      price: number;
      emoji: string;
      image_url: string | null;
      available: number;
      sku: string | null;
    }
  >();

  for (const row of rows) {
    if (!row.is_active) continue;
    const prev = byProduct.get(row.product_id);
    const available = Number(row.available_stock ?? 0);
    if (prev) {
      prev.available += available;
      // Conservar la primera image_url no nula que encontremos
      if (!prev.image_url && row.image_url) {
        prev.image_url = row.image_url;
      }
    } else {
      byProduct.set(row.product_id, {
        id: row.product_id,
        name: row.product_name,
        price: Number(row.price ?? 0),
        emoji: row.emoji || "💅",
        image_url: row.image_url ?? null,
        available,
        sku: row.sku,
      });
    }
  }

  return Array.from(byProduct.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: "Todos",
      price: p.price,
      emoji: p.emoji,
      image_url: p.image_url,
      available: p.available > 0,
      description: p.sku ? `SKU: ${p.sku}` : undefined,
      stock: p.available,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5 text-amber-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < n ? "fill-amber-400" : "fill-none opacity-30"}`}
        />
      ))}
    </span>
  );
}

function TiendaPage() {
  const qc = useQueryClient();
  const [config, setConfig] = useState<StoreConfig>(() => loadStoreConfig());

  useEffect(() => {
    setConfig(loadStoreConfig());
    return subscribeStoreConfig(() => setConfig(loadStoreConfig()));
  }, []);

  const theme = config.theme;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<StoreCategory>("Todos");
  const [cartOpen, setCartOpen] = useState(false);
  const [items, setItems] = useState<CartItem[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const refreshCart = useCallback(() => {
    setItems(getCartItems());
    setCartCount(getCartCount());
    setCartTotal(getCartTotal());
  }, []);

  useEffect(() => {
    refreshCart();
    return subscribeCart(refreshCart);
  }, [refreshCart]);

  const {
    data: inventory = [],
    isLoading: loadingInventory,
    isFetching,
  } = useQuery({
    queryKey: ["shared-inventory", "tienda-publica"],
    queryFn: getSharedInventory,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: onlineBranchId } = useQuery({
    queryKey: ["online-branch-id"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id")
        .eq("is_active", true)
        .order("name")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: 60_000,
  });

  const products = useMemo(
    () => mapInventoryToStoreProducts(inventory),
    [inventory],
  );

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.id, p.stock);
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q);
      const matchCat = category === "Todos" || p.category === category;
      return matchSearch && matchCat;
    });
  }, [products, search, category]);

  const handleAdd = (product: StoreProduct) => {
    const stock = stockByProduct.get(product.id) ?? 0;
    if (stock <= 0) {
      toast.error("Producto sin existencia");
      return;
    }
    const inCart =
      getCartItems().find((i) => i.productId === product.id)?.quantity ?? 0;
    if (inCart + 1 > stock) {
      toast.error(`Solo hay ${stock} disponibles`);
      return;
    }
    addToCart(product, 1);
    refreshCart();
    toast.success(`${product.name} agregado al carrito`);
  };

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!onlineBranchId) {
        throw new Error("No hay sucursal activa para el pedido online");
      }
      const cart = getCartItems();
      if (!cart.length) throw new Error("El carrito está vacío");

      for (const item of cart) {
        const available = stockByProduct.get(item.productId) ?? 0;
        if (item.quantity > available) {
          throw new Error(
            `Stock insuficiente para ${item.name}. Disponible: ${available}`,
          );
        }
      }

      const orderItems = cart.map((item) => ({
        product_id: item.productId,
        name: item.name,
        unit_price: item.price,
        quantity: item.quantity,
      }));

      const { data, error } = await supabase.rpc("create_online_order", {
        _branch_id: onlineBranchId,
        _items: orderItems,
        ...(customerName.trim()
          ? { _customer_name: customerName.trim() }
          : {}),
        ...(customerPhone.trim()
          ? { _customer_phone: customerPhone.trim() }
          : {}),
        ...(address.trim() ? { _delivery_address: address.trim() } : {}),
        ...(notes.trim() ? { _notes: notes.trim() } : {}),
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("¡Pedido confirmado! Stock reservado del inventario compartido.");
      clearCart();
      refreshCart();
      setCartOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setAddress("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["pos-products-shared"] });
      void qc.invalidateQueries({ queryKey: ["pos-variant-inventory-shared"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo crear el pedido");
    },
  });

  const remainingForFreeShipping = Math.max(
    0,
    theme.freeShippingFrom - cartTotal,
  );

  return (
    <div
      className="min-h-screen text-rose-950"
      style={{ backgroundColor: theme.background }}
    >
      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:pt-8">
        {/* HERO */}
        <section
          className="relative mb-8 overflow-hidden rounded-3xl px-6 py-12 text-white sm:px-12 sm:py-16"
          style={{
            background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)`,
          }}
        >
          <div className="relative z-10 max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/80">
              Lula Shop
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">
              {theme.heroTitle}
            </h1>
            <p className="mt-4 text-sm text-white/90 sm:text-base">
              {theme.heroSubtitle}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href="#catalogo"
                className="inline-flex h-12 items-center rounded-full bg-white px-6 text-sm font-bold shadow-lg"
                style={{ color: theme.primary }}
              >
                {theme.heroCta}
              </a>
              <div className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-medium backdrop-blur">
                <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />
                {theme.ratingValue}/5 · {theme.ratingCount} reseñas
              </div>
            </div>
            {isFetching && (
              <p className="mt-4 text-xs text-white/60">
                Actualizando inventario…
              </p>
            )}
          </div>
          <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        </section>

        {/* Banners configurables */}
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {config.banners
            .filter((b) => b.active)
            .sort((a, b) => a.order - b.order)
            .map((b) => (
              <a
                key={b.id}
                href={b.ctaLink || "#catalogo"}
                className="block overflow-hidden rounded-2xl px-6 py-8 transition hover:opacity-95"
                style={{ backgroundColor: b.bgColor, color: b.textColor }}
              >
                <p className="text-xl font-bold sm:text-2xl">{b.title}</p>
                {b.subtitle && (
                  <p className="mt-1 text-sm opacity-90">{b.subtitle}</p>
                )}
                {b.ctaText && (
                  <span className="mt-4 inline-block rounded-full bg-white/20 px-4 py-1.5 text-xs font-semibold">
                    {b.ctaText} →
                  </span>
                )}
              </a>
            ))}
        </div>

        {/* Trust strip */}
        <div className="mb-10 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Truck,
              title: "Envíos a todo México",
              body: theme.shippingNote,
            },
            {
              icon: Package,
              title: "Inventario real",
              body: "Mismo stock que tus sucursales físicas. Sin sorpresas.",
            },
            {
              icon: ShieldCheck,
              title: "Compra segura",
              body: "Pedidos con reserva de stock y seguimiento en el sistema.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex gap-3 rounded-2xl border border-rose-100 bg-white p-4 shadow-sm"
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: theme.primary }}
              >
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-rose-950">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-rose-500">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Reseñas / comentarios */}
        <section className="mb-12">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-rose-400">
                Clientes felices
              </p>
              <h2 className="mt-1 text-2xl font-bold text-rose-950">
                {theme.trustLine}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-rose-600">
              <Stars n={5} />
              <span className="font-semibold">
                {theme.ratingValue}/5 · {theme.ratingCount}
              </span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {config.reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm"
              >
                <Stars n={r.rating} />
                <p className="mt-3 text-sm leading-relaxed text-rose-800">
                  “{r.text}”
                </p>
                <p className="mt-3 text-xs font-semibold text-rose-950">
                  {r.name}
                  {r.city ? (
                    <span className="font-normal text-rose-400">
                      {" "}
                      · {r.city}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Catálogo */}
        <section id="catalogo">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-rose-400">
                Catálogo
              </p>
              <h2 className="mt-1 text-2xl font-bold text-rose-950">
                Productos disponibles
              </h2>
              <p className="mt-1 text-sm text-rose-500">
                Stock del inventario compartido Pixel Perfect (consulta cada 15
                s)
              </p>
            </div>
            {cartTotal > 0 && remainingForFreeShipping > 0 && (
              <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900">
                Te faltan{" "}
                <strong>
                  ${remainingForFreeShipping.toLocaleString("es-MX")}
                </strong>{" "}
                para envío gratis
              </div>
            )}
            {cartTotal >= theme.freeShippingFrom && cartTotal > 0 && (
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800">
                ✓ Tu pedido califica para envío gratis
              </div>
            )}
          </div>

          <div className="mb-6 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STORE_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "text-white shadow-sm"
                      : "border border-rose-100 bg-white text-rose-700 hover:border-rose-300"
                  }`}
                  style={
                    active
                      ? { backgroundColor: theme.primary }
                      : undefined
                  }
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {loadingInventory ? (
            <div className="rounded-2xl border border-dashed border-rose-200 bg-white py-20 text-center">
              <p className="text-sm font-medium text-rose-800">
                Cargando catálogo e inventario…
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-rose-200 bg-white py-20 text-center">
              <p className="text-sm font-medium text-rose-800">
                No hay productos con ese criterio
              </p>
              <p className="mt-1 text-xs text-rose-400">
                Prueba otra búsqueda o revisa el inventario en el sistema
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {filtered.map((product) => (
                <StoreProductCard
                  key={product.id}
                  product={product}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          )}
        </section>

        {/* FAQ / envíos */}
        <section className="mt-16 rounded-3xl border border-rose-100 bg-white p-6 shadow-sm sm:p-10">
          <div className="flex items-center gap-2">
            <MessageCircle
              className="h-5 w-5"
              style={{ color: theme.primary }}
            />
            <h2 className="text-xl font-bold text-rose-950">
              Envíos y garantía
            </h2>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-rose-900">
                ¿Cuánto tarda el envío?
              </p>
              <p className="mt-1 text-sm text-rose-500">
                {theme.shippingNote}. El tiempo exacto se confirma al procesar
                tu pedido.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-rose-900">
                ¿Hay envío gratis?
              </p>
              <p className="mt-1 text-sm text-rose-500">
                {theme.freeShippingText}. El umbral se configura desde el panel
                de Pedidos.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-rose-900">
                ¿El stock es real?
              </p>
              <p className="mt-1 text-sm text-rose-500">
                Sí. Usamos el inventario compartido de Pixel Perfect (mismas
                existencias que las 2 sucursales físicas). Se actualiza cada 15
                segundos.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-rose-900">
                ¿Cómo doy seguimiento?
              </p>
              <p className="mt-1 text-sm text-rose-500">
                Cada compra llega a la pantalla Pedidos del sistema para
                confirmar, preparar y entregar.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rose-100 bg-white py-10 text-center">
        <p
          className="text-sm font-bold"
          style={{ color: theme.primary }}
        >
          Lula Shop
        </p>
        <p className="mt-1 text-xs text-rose-400">{theme.footerText}</p>
        <p className="mt-3 text-[11px] text-rose-300">
          Inventario unificado · Configuración desde el panel de administración
        </p>
      </footer>

      <StoreCartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        items={items}
        total={cartTotal}
        stockByProduct={stockByProduct}
        customerName={customerName}
        customerPhone={customerPhone}
        address={address}
        notes={notes}
        onCustomerNameChange={setCustomerName}
        onCustomerPhoneChange={setCustomerPhone}
        onAddressChange={setAddress}
        onNotesChange={setNotes}
        placing={placeOrder.isPending}
        onPlaceOrder={() => placeOrder.mutate()}
        onIncrease={(id) => {
          const current =
            items.find((i) => i.productId === id)?.quantity ?? 0;
          const max = stockByProduct.get(id) ?? 0;
          if (current + 1 > max) {
            toast.error(`Solo hay ${max} disponibles`);
            return;
          }
          setCartQuantity(id, current + 1);
          refreshCart();
        }}
        onDecrease={(id) => {
          const current =
            items.find((i) => i.productId === id)?.quantity ?? 0;
          setCartQuantity(id, current - 1);
          refreshCart();
        }}
        onRemove={(id) => {
          removeFromCart(id);
          refreshCart();
        }}
        onClear={() => {
          clearCart();
          refreshCart();
          toast.message("Carrito vaciado");
        }}
      />
    </div>
  );
}