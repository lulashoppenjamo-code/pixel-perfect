
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SlidersHorizontal, ChevronLeft, ChevronRight, Package,
  RefreshCw, Filter, X
} from "lucide-react";

import { StoreHeader } from "@/components/store/StoreHeader";
import { StoreProductCard } from "@/components/store/StoreProductCard";
import { StoreCartSheet } from "@/components/store/StoreCartSheet";
import { type StoreProduct } from "@/lib/store/demoCatalog";
import {
  addToCart, clearCart, getCartItems, getCartCount, getCartTotal,
  removeFromCart, setCartQuantity, subscribeCart, type CartItem
} from "@/lib/store/cart";
import {
  loadStoreConfig, subscribeStoreConfig, type StoreConfig
} from "@/lib/store/storeConfig";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop | Tienda en línea" },
      {
        name: "description",
        content: "Compra productos de belleza, uñas, pestañas y accesorios en Lula Shop."
      }
    ]
  }),
  component: TiendaPage
});

type OnlineCatalogRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  online_description: string | null;
  category_id: string | null;
  price: number;
  image_url: string | null;
  emoji: string | null;
  has_variants: boolean;
  online_order: number;
  available_stock: number;
};

type CategoryRow = { id: string; name: string };

type SortOption =
  | "recommended"
  | "name-asc"
  | "name-desc"
  | "price-asc"
  | "price-desc";

const PAGE_SIZE = 40;
const PINK = "#E95C9B";
const DARK_PINK = "#C93678";

function mapCatalog(
  rows: OnlineCatalogRow[],
  categoryById: Map<string, string>
): (StoreProduct & { stock: number })[] {
  return rows.map((row) => {
    const stock = Math.max(0, Number(row.available_stock ?? 0));

    return {
      id: row.id,
      name: row.name,
      category:
        (row.category_id && categoryById.get(row.category_id)) ||
        (row.category_id ? "Sin categoría" : "General"),
      price: Number(row.price ?? 0),
      emoji: row.emoji || "💅",
      image_url: row.image_url ?? null,
      available: stock > 0,
      description: row.online_description?.trim() ||
        row.description?.trim() ||
        (row.sku ? `SKU: ${row.sku}` : undefined),
      stock
    };
  });
}

async function fetchCatalog(): Promise<OnlineCatalogRow[]> {
  const all: OnlineCatalogRow[] = [];
  const pageSize = 500;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("v_online_catalog")
      .select(
        "id, name, sku, barcode, description, online_description, category_id, price, image_url, emoji, has_variants, online_order, available_stock"
      )
      .order("online_order", { ascending: true })
      .order("name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as OnlineCatalogRow[];
    all.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function fetchCategories(ids: string[]) {
  const result = new Map<string, string>();
  if (!ids.length) return result;

  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .in("id", ids);

  if (error) throw error;

  for (const row of (data ?? []) as CategoryRow[]) {
    result.set(row.id, row.name);
  }

  return result;
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
  const [category, setCategory] = useState("Todos");
  const [sort, setSort] = useState<SortOption>("recommended");
  const [page, setPage] = useState(1);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
    data: catalogPayload,
    isLoading: loadingInventory,
    isFetching,
    isError,
    refetch
  } = useQuery({
    queryKey: ["online-catalog", "tienda-publica"],
    queryFn: async () => {
      const rows = await fetchCatalog();
      const ids = Array.from(new Set(
        rows.map((row) => row.category_id).filter(
          (id): id is string => Boolean(id)
        )
      ));
      const categoryById = await fetchCategories(ids);
      return { rows, categoryById };
    },
    refetchInterval: 15000,
    staleTime: 5000
  });

  // Se conserva la selección de sucursal del sistema actual.
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

      if (error) {
        console.warn("[tienda] Error de sucursal:", error.message);
        return null;
      }

      return data?.id ?? null;
    },
    staleTime: 60000,
    retry: false
  });

  const products = useMemo(() => {
    if (!catalogPayload) return [];
    return mapCatalog(catalogPayload.rows, catalogPayload.categoryById);
  }, [catalogPayload]);

  const categories = useMemo(() => {
    const names = new Set(products.map((p) => p.category).filter(Boolean));
    return ["Todos", ...Array.from(names).sort((a, b) =>
      a.localeCompare(b, "es")
    )];
  }, [products]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => map.set(p.id, p.stock));
    return map;
  }, [products]);

  const priceBounds = useMemo(() => {
    const prices = products.map((p) => p.price);
    return {
      min: prices.length ? Math.floor(Math.min(...prices)) : 0,
      max: prices.length ? Math.ceil(Math.max(...prices)) : 1000
    };
  }, [products]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    const min = minPrice.trim() ? Number(minPrice) : 0;
    const max = maxPrice.trim()
      ? Number(maxPrice)
      : Number.POSITIVE_INFINITY;

    const result = products.filter((p) => {
      const matchesSearch =
        !query ||
        p.name.toLocaleLowerCase("es").includes(query) ||
        (p.description || "").toLocaleLowerCase("es").includes(query) ||
        p.category.toLocaleLowerCase("es").includes(query);

      const matchesCategory = category === "Todos" || p.category === category;
      const matchesStock = showOutOfStock || p.available;
      const matchesPrice = p.price >= min && p.price <= max;

      return matchesSearch && matchesCategory && matchesStock && matchesPrice;
    });

    switch (sort) {
      case "name-asc":
        result.sort((a, b) => a.name.localeCompare(b.name, "es"));
        break;
      case "name-desc":
        result.sort((a, b) => b.name.localeCompare(a.name, "es"));
        break;
      case "price-asc":
        result.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        result.sort((a, b) => b.price - a.price);
        break;
    }

    return result;
  }, [
    products, search, category, showOutOfStock,
    minPrice, maxPrice, sort
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [search, category, sort, showOutOfStock, minPrice, maxPrice]);

  const handleAdd = (product: StoreProduct, quantity = 1) => {
    const stock = stockByProduct.get(product.id) ?? 0;
    const existing = getCartItems().find(
      (item) => item.productId === product.id
    )?.quantity ?? 0;

    if (stock <= 0 || existing + quantity > stock) {
      toast.error(`Existencia insuficiente. Disponible: ${stock}`);
      return;
    }

    addToCart(product, quantity);
    refreshCart();
    toast.success(`${quantity} pieza(s) agregadas al carrito`);
  };

  // Se conserva el mecanismo actual de creación de pedidos.
  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!onlineBranchId) {
        throw new Error("No hay sucursal activa para el pedido online.");
      }

      const cart = getCartItems();
      if (!cart.length) throw new Error("El carrito está vacío");

      for (const item of cart) {
        const available = stockByProduct.get(item.productId) ?? 0;
        if (item.quantity > available) {
          throw new Error(
            `Stock insuficiente para ${item.name}. Disponible: ${available}`
          );
        }
      }

      const orderItems = cart.map((item) => ({
        product_id: item.productId,
        name: item.name,
        unit_price: item.price,
        quantity: item.quantity
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
        ...(address.trim()
          ? { _delivery_address: address.trim() }
          : {}),
        ...(notes.trim() ? { _notes: notes.trim() } : {})
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("¡Pedido enviado correctamente!");
      clearCart();
      refreshCart();
      setCartOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setAddress("");
      setNotes("");

      void qc.invalidateQueries({ queryKey: ["online-catalog"] });
      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["pos-products-shared"] });
      void qc.invalidateQueries({
        queryKey: ["pos-variant-inventory-shared"]
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo crear el pedido");
    }
  });

  const resetFilters = () => {
    setSearch("");
    setCategory("Todos");
    setSort("recommended");
    setShowOutOfStock(false);
    setMinPrice("");
    setMaxPrice("");
    setPage(1);
  };

  const changePage = (next: number) => {
    setPage(Math.max(1, Math.min(totalPages, next)));
    document.getElementById("catalogo")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const Filters = () => (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 border-b border-pink-100 pb-2 text-sm font-bold text-pink-900">
          Categorías
        </h3>
        <div className="space-y-1">
          {categories.filter((c) => c !== "Todos").map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setCategory(cat);
                setMobileFiltersOpen(false);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs hover:bg-pink-50"
              style={{
                color: category === cat ? DARK_PINK : "#475569",
                fontWeight: category === cat ? 700 : 400
              }}
            >
              {cat}
              {category === cat && <span>✓</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCategory("Todos")}
            className="w-full px-2 py-2 text-left text-xs font-bold text-pink-700"
          >
            Ver todas las categorías
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-3 border-b border-pink-100 pb-2 text-sm font-bold text-pink-900">
          Precio
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-slate-500">
            Desde
            <input
              type="number"
              min="0"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder={String(priceBounds.min)}
              className="mt-1 h-9 w-full rounded border border-pink-200 px-2 text-xs text-slate-800"
            />
          </label>
          <label className="text-[10px] text-slate-500">
            Hasta
            <input
              type="number"
              min="0"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder={String(priceBounds.max)}
              className="mt-1 h-9 w-full rounded border border-pink-200 px-2 text-xs text-slate-800"
            />
          </label>
        </div>
      </section>

      <section>
        <h3 className="mb-3 border-b border-pink-100 pb-2 text-sm font-bold text-pink-900">
          Disponibilidad
        </h3>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showOutOfStock}
            onChange={(e) => setShowOutOfStock(e.target.checked)}
            className="accent-pink-600"
          />
          Mostrar productos agotados
        </label>
      </section>

      <button
        type="button"
        onClick={resetFilters}
        className="w-full rounded-full border border-pink-300 py-2 text-xs font-bold text-pink-700"
      >
        Borrar filtros
      </button>
    </div>
  );

  return (
    <div
      className="min-h-screen bg-[#FFF8FB] text-slate-800"
      style={{
        backgroundColor: "#FFF8FB",
        "--store-primary": PINK
      } as CSSProperties}
    >
      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-[1500px] px-3 pb-12 sm:px-6 lg:px-8">
        <section
          id="catalogo"
          className="scroll-mt-44 pt-7 sm:pt-10"
        >
          <div className="mb-6 flex flex-col gap-3 border-b border-pink-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold text-pink-950 sm:text-3xl">
                Productos
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                {filtered.length} productos encontrados
                {isFetching ? " · Actualizando catálogo" : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="flex h-10 items-center gap-2 rounded-full border border-pink-200 bg-white px-4 text-xs font-bold text-pink-700 lg:hidden"
              >
                <Filter className="h-4 w-4" />
                Filtrar
              </button>

              <label className="flex h-10 items-center gap-2 rounded-full border border-pink-200 bg-white px-3">
                <SlidersHorizontal className="h-4 w-4 text-pink-600" />
                <span className="text-[10px] text-slate-500">Ordenar</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="max-w-[170px] bg-transparent text-[10px] font-semibold text-pink-900 outline-none sm:text-xs"
                >
                  <option value="recommended">Recomendados</option>
                  <option value="price-asc">Precio: menor a mayor</option>
                  <option value="price-desc">Precio: mayor a menor</option>
                  <option value="name-asc">A - Z</option>
                  <option value="name-desc">Z - A</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-48 border border-pink-100 bg-white p-4">
                <div className="mb-5 flex items-center gap-2 border-b border-pink-100 pb-3">
                  <Filter className="h-4 w-4 text-pink-600" />
                  <h2 className="text-sm font-extrabold text-pink-950">
                    Filtros
                  </h2>
                </div>
                <Filters />
              </div>
            </aside>

            <div className="min-w-0">
              {loadingInventory && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="animate-pulse bg-white">
                      <div className="aspect-square bg-pink-100" />
                      <div className="space-y-3 p-3">
                        <div className="h-3 rounded bg-pink-100" />
                        <div className="h-4 rounded bg-pink-100" />
                        <div className="h-9 rounded bg-pink-100" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loadingInventory && isError && (
                <div className="bg-white px-5 py-16 text-center">
                  <Package className="mx-auto h-10 w-10 text-pink-300" />
                  <h3 className="mt-4 font-bold text-pink-900">
                    No pudimos cargar los productos
                  </h3>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-5 rounded-full px-6 py-2 text-xs font-bold text-white"
                    style={{ backgroundColor: PINK }}
                  >
                    <RefreshCw className="mr-1 inline h-4 w-4" />
                    Volver a cargar
                  </button>
                </div>
              )}

              {!loadingInventory && !isError && filtered.length === 0 && (
                <div className="bg-white px-5 py-16 text-center">
                  <Package className="mx-auto h-10 w-10 text-pink-300" />
                  <h3 className="mt-4 font-bold text-pink-900">
                    No encontramos productos
                  </h3>
                  <p className="mt-2 text-xs text-slate-500">
                    Prueba con otra búsqueda o elimina los filtros.
                  </p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-5 rounded-full px-6 py-2 text-xs font-bold text-white"
                    style={{ backgroundColor: PINK }}
                  >
                    Borrar filtros
                  </button>
                </div>
              )}

              {!loadingInventory && !isError && visibleProducts.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {visibleProducts.map((product) => (
                      <StoreProductCard
                        key={product.id}
                        product={product}
                        onAdd={handleAdd}
                      />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => changePage(currentPage - 1)}
                        className="flex h-10 items-center gap-1 border border-pink-200 bg-white px-4 text-xs font-bold text-pink-700 disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Anterior
                      </button>

                      <span className="px-3 text-xs text-slate-500">
                        Página {currentPage} de {totalPages}
                      </span>

                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => changePage(currentPage + 1)}
                        className="flex h-10 items-center gap-1 border border-pink-200 bg-white px-4 text-xs font-bold text-pink-700 disabled:opacity-40"
                      >
                        Siguiente
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        <section
          id="como-comprar"
          className="mt-14 border-y border-pink-100 bg-white px-5 py-9"
        >
          <h2 className="text-center text-xl font-extrabold text-pink-950">
            ¿Cómo comprar en Lula Shop?
          </h2>
          <div className="mx-auto mt-6 grid max-w-4xl gap-5 text-center sm:grid-cols-3">
            <div>
              <p className="font-bold text-pink-700">01 · Encuentra</p>
              <p className="mt-1 text-xs text-slate-500">Busca tus productos favoritos.</p>
            </div>
            <div>
              <p className="font-bold text-pink-700">02 · Agrega</p>
              <p className="mt-1 text-xs text-slate-500">Elige las cantidades y agrega al carrito.</p>
            </div>
            <div>
              <p className="font-bold text-pink-700">03 · Recibe</p>
              <p className="mt-1 text-xs text-slate-500">Elige recoger o recibir tu pedido.</p>
            </div>
          </div>
        </section>

        <section id="preguntas" className="mx-auto mt-12 max-w-3xl">
          <h2 className="mb-5 text-center text-xl font-extrabold text-pink-950">
            Preguntas frecuentes
          </h2>
          {[
            ["¿Las existencias están actualizadas?", "El catálogo consulta periódicamente las existencias disponibles. La disponibilidad se vuelve a validar al realizar el pedido."],
            ["¿Cómo puedo pagar?", "Puedes elegir transferencia bancaria o pago al recoger o recibir, según las opciones disponibles al confirmar tu pedido."],
            ["¿Puedo recoger en sucursal?", "Sí, puedes elegir recoger tu pedido en una sucursal de Lula Shop."],
            ["¿Puedo recibir mi compra en casa?", "Sí, puedes elegir envío a domicilio e indicar tu dirección al realizar el pedido."]
          ].map(([question, answer]) => (
            <details key={question} className="mb-2 border border-pink-100 bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold text-pink-900">
                {question}
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {answer}
              </p>
            </details>
          ))}
        </section>
      </main>

      <footer
        id="contacto"
        className="mt-14 px-5 py-12 text-center text-white"
        style={{ background: `linear-gradient(135deg, ${PINK}, ${DARK_PINK})` }}
      >
        <p className="text-2xl font-black tracking-widest">LULA SHOP</p>
        <p className="mt-2 text-xs text-white/90">{theme.footerText}</p>
        <p className="mt-6 text-[10px] text-white/70">
          Belleza · Uñas · Pestañas · Accesorios
        </p>
      </footer>

      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="Cerrar filtros"
            onClick={() => setMobileFiltersOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-pink-100 px-5 py-4">
              <h2 className="font-extrabold text-pink-950">Filtros</h2>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Cerrar"
                className="text-pink-700"
              >
                <X />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <Filters />
            </div>
            <div className="border-t border-pink-100 p-4">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="h-11 w-full rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: PINK }}
              >
                Ver {filtered.length} productos
              </button>
            </div>
          </div>
        </div>
      )}

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
          const current = items.find((item) => item.productId === id)?.quantity ?? 0;
          const max = stockByProduct.get(id) ?? 0;
          if (current + 1 > max) {
            toast.error(`Solo hay ${max} disponibles`);
            return;
          }
          setCartQuantity(id, current + 1);
          refreshCart();
        }}
        onDecrease={(id) => {
          const current = items.find((item) => item.productId === id)?.quantity ?? 0;
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
