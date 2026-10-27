import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { loadStoreConfig } from "@/lib/store/storeConfig";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop — Tienda en línea" },
      {
        name: "description",
        content:
          "Tienda pública de Lula Shop. Mismo inventario que tus sucursales físicas.",
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
    } else {
      byProduct.set(row.product_id, {
        id: row.product_id,
        name: row.product_name,
        price: Number(row.price ?? 0),
        emoji: row.emoji || "💅",
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
      available: p.available > 0,
      description: p.sku ? `SKU: ${p.sku}` : undefined,
      stock: p.available,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function TiendaPage() {
  const qc = useQueryClient();
  const config = loadStoreConfig();

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
    for (const p of products) {
      map.set(p.id, p.stock);
    }
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
        throw new Error(
          "No hay sucursal activa para registrar el pedido online",
        );
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
      toast.success(
        "Pedido creado. Stock reservado del inventario compartido.",
      );
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
      void qc.invalidateQueries({
        queryKey: ["pos-variant-inventory-shared"],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || "No se pudo crear el pedido");
    },
  });

  const theme = config.theme;

  return (
    <div
      className="min-h-screen text-rose-950"
      style={{ backgroundColor: theme.background || "#fdf8f9" }}
    >
      <div
        className="px-4 py-2 text-center text-xs font-semibold text-white sm:text-sm"
        style={{ backgroundColor: theme.primary || "#e11d48" }}
      >
        {theme.promoBarText}
        {theme.freeShippingText ? ` · ${theme.freeShippingText}` : ""}
      </div>

      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:pt-8">
        <section
          className="mb-8 overflow-hidden rounded-2xl px-6 py-10 text-white sm:px-10"
          style={{
            background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
            Lula Shop
          </p>
          <h1 className="mt-2 max-w-xl text-2xl font-bold leading-tight sm:text-4xl">
            {theme.heroTitle}
          </h1>
          <p className="mt-3 max-w-lg text-sm text-white/90 sm:text-base">
            {theme.heroSubtitle}
          </p>
          {isFetching && (
            <p className="mt-3 text-xs text-white/70">
              Actualizando stock en tiempo real…
            </p>
          )}
        </section>

        {config.banners
          .filter((b) => b.active)
          .sort((a, b) => a.order - b.order)
          .map((b) => (
            <div
              key={b.id}
              className="mb-4 rounded-2xl px-5 py-6 text-center"
              style={{ backgroundColor: b.bgColor, color: b.textColor }}
            >
              <p className="text-lg font-bold sm:text-xl">{b.title}</p>
              {b.subtitle && (
                <p className="mt-1 text-sm opacity-90">{b.subtitle}</p>
              )}
            </div>
          ))}

        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Inventario único.</strong> El stock que ves es el mismo de
          tus 2 sucursales físicas y de la tienda en línea. Al comprar se
          reserva automáticamente.
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
                    ? "bg-rose-600 text-white shadow-sm"
                    : "border border-rose-100 bg-white text-rose-700 hover:border-rose-300"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {loadingInventory ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-white py-16 text-center">
            <p className="text-sm font-medium text-rose-800">
              Cargando catálogo e inventario…
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-white py-16 text-center">
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
              <div key={product.id} className="relative">
                <StoreProductCard product={product} onAdd={handleAdd} />
                <p className="mt-1 text-center text-[11px] text-rose-400">
                  {product.stock > 0
                    ? `${product.stock} en stock`
                    : "Agotado"}
                </p>
              </div>
            ))}
          </div>
        )}

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Un solo inventario",
              body: "Físicas + online comparten la misma existencia. Sin duplicar stock.",
            },
            {
              title: "Stock en tiempo real",
              body: "Se actualiza solo. Al vender online se reserva al instante.",
            },
            {
              title: "Seguimiento en Pedidos",
              body: "Cada compra llega a la pantalla Pedidos para entregar o cancelar.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm"
            >
              <h3 className="text-sm font-bold text-rose-900">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-rose-500">
                {item.body}
              </p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-rose-100 bg-white py-8 text-center text-xs text-rose-400">
        <p className="font-medium text-rose-600">Lula Shop</p>
        <p className="mt-1">Tienda pública · Inventario compartido</p>
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