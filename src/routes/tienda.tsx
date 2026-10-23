import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { StoreHeader } from "@/components/store/StoreHeader";
import { StoreProductCard } from "@/components/store/StoreProductCard";
import { StoreCartSheet } from "@/components/store/StoreCartSheet";
import {
  DEMO_PRODUCTS,
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

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop — Tienda en línea" },
      {
        name: "description",
        content:
          "Tienda pública de Lula Shop. Compra productos de uñas y cuidado de forma fácil.",
      },
    ],
  }),
  component: TiendaPage,
});

function TiendaPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<StoreCategory>("Todos");
  const [cartOpen, setCartOpen] = useState(false);
  const [items, setItems] = useState<CartItem[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);

  const refreshCart = useCallback(() => {
    setItems(getCartItems());
    setCartCount(getCartCount());
    setCartTotal(getCartTotal());
  }, []);

  useEffect(() => {
    refreshCart();
    return subscribeCart(refreshCart);
  }, [refreshCart]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DEMO_PRODUCTS.filter((p) => {
      const matchCat = category === "Todos" || p.category === category;
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [search, category]);

  const handleAdd = (product: StoreProduct) => {
    addToCart(product, 1);
    refreshCart();
    toast.success(`${product.name} agregado al carrito`);
  };

  return (
    <div className="min-h-screen bg-[#fdf8f9] text-rose-950">
      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:pt-8">
        <section className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 px-6 py-10 text-white shadow-md sm:px-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-rose-100">
            Lula Shop
          </p>
          <h1 className="mt-2 max-w-xl text-2xl font-bold leading-tight sm:text-4xl">
            Todo para tus uñas, en un solo lugar
          </h1>
          <p className="mt-3 max-w-lg text-sm text-rose-100 sm:text-base">
            Explora el catálogo, agrega al carrito y prepárate para pedir en
            línea. Esta es la vista pública de la tienda.
          </p>
        </section>

        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Catálogo de demostración.</strong>{" "}
          Los productos y precios mostrados no provienen de la base de datos
          real. Se conectarán cuando exista una fuente pública segura.
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

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-white py-16 text-center">
            <p className="text-sm font-medium text-rose-800">
              No hay productos con ese criterio
            </p>
            <p className="mt-1 text-xs text-rose-400">
              Prueba otra categoría o borra la búsqueda
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

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "Catálogo actualizado",
              body: "Los productos reales se publicarán desde Pixel Perfect.",
            },
            {
              title: "Pedidos en un solo lugar",
              body: "Los pedidos llegarán a la pantalla de administración.",
            },
            {
              title: "Inventario compartido",
              body: "Misma existencia para tus sucursales, sin duplicar stock.",
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
        <p className="mt-1">Tienda pública · Pixel Perfect OS</p>
      </footer>

      <StoreCartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        items={items}
        total={cartTotal}
        onIncrease={(id) => {
          const current =
            items.find((i) => i.productId === id)?.quantity ?? 0;
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