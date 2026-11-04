
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Package,
  Truck,
  ShieldCheck,
  MessageCircle,
  RefreshCw,
  ArrowRight,
  ChevronDown,
} from "lucide-react";

import { StoreHeader } from "@/components/store/StoreHeader";
import { StoreProductCard } from "@/components/store/StoreProductCard";
import { StoreCartSheet } from "@/components/store/StoreCartSheet";
import { type StoreProduct } from "@/lib/store/demoCatalog";
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
  loadStoreConfig,
  subscribeStoreConfig,
  type StoreConfig,
} from "@/lib/store/storeConfig";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop | Tienda en línea" },
      {
        name: "description",
        content:
          "Encuentra productos profesionales para uñas, belleza y cuidado personal en Lula Shop.",
      },
    ],
  }),
  component: TiendaPage,
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

type CategoryRow = {
  id: string;
  name: string;
};

type SortOption = "recommended" | "name-asc" | "name-desc" | "price-asc" | "price-desc";

const PAGE_SIZE = 16;

/** Foto de fondo de la portada (opcional). Pega aquí la URL de TU propia imagen. */
const HERO_IMAGE_URL = "";

/** Número de WhatsApp con código de país, sin + ni espacios (ej. 52XXXXXXXXXX). Vacío = botón oculto. */
const WHATSAPP_NUMBER = "";

function mapCatalogToStoreProducts(
  rows: OnlineCatalogRow[],
  categoryById: Map<string, string>,
): (StoreProduct & { stock: number })[] {
  return rows
    .map((row) => {
      const stock = Number(row.available_stock ?? 0);
      const categoryName =
        (row.category_id && categoryById.get(row.category_id)) ||
        (row.category_id ? "Sin categoría" : "General");

      return {
        id: row.id,
        name: row.name,
        category: categoryName,
        price: Number(row.price ?? 0),
        emoji: row.emoji || "💅",
        image_url: row.image_url ?? null,
        available: stock > 0,
        description:
          row.online_description?.trim() ||
          (row.sku ? `SKU: ${row.sku}` : undefined),
        stock,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function fetchPublicCatalog(): Promise<OnlineCatalogRow[]> {
  const pageSize = 500;
  const all: OnlineCatalogRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("v_online_catalog")
      .select(
        "id, name, sku, barcode, description, online_description, category_id, price, image_url, emoji, has_variants, online_order, available_stock",
      )
      .order("online_order", { ascending: true })
      .order("name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as OnlineCatalogRow[];
    all.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function fetchCategoryNames(
  categoryIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!categoryIds.length) return map;

  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .in("id", categoryIds);

  if (error || !data) return map;

  for (const row of data as CategoryRow[]) {
    if (row.id && row.name) map.set(row.id, row.name);
  }

  return map;
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
    refetch,
  } = useQuery({
    queryKey: ["online-catalog", "tienda-publica"],
    queryFn: async () => {
      const rows = await fetchPublicCatalog();

      const ids = Array.from(
        new Set(
          rows
            .map((r) => r.category_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const categoryById = await fetchCategoryNames(ids);

      return { rows, categoryById };
    },
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

      if (error) {
        console.warn("[tienda] No se pudo leer branches:", error.message);
        return null;
      }

      return data?.id ?? null;
    },
    staleTime: 60_000,
    retry: false,
  });

  const products = useMemo(() => {
    if (!catalogPayload) return [];

    return mapCatalogToStoreProducts(
      catalogPayload.rows,
      catalogPayload.categoryById,
    );
  }, [catalogPayload]);

  const storeCategories = useMemo(() => {
    const categories = new Set<string>();

    for (const product of products) {
      if (product.category) categories.add(product.category);
    }

    return [
      "Todos",
      ...Array.from(categories).sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    ];
  }, [products]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();

    for (const product of products) {
      map.set(product.id, product.stock);
    }

    return map;
  }, [products]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");

    const result = products.filter((product) => {
      const matchesSearch =
        !query ||
        product.name.toLocaleLowerCase("es").includes(query) ||
        (product.description || "").toLocaleLowerCase("es").includes(query) ||
        product.category.toLocaleLowerCase("es").includes(query);

      const matchesCategory =
        category === "Todos" || product.category === category;

      const matchesStock =
        showOutOfStock || product.available;

      return matchesSearch && matchesCategory && matchesStock;
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
      default:
        break;
    }

    return result;
  }, [products, search, category, sort, showOutOfStock]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [search, category, sort, showOutOfStock]);

  const handleAdd = (product: StoreProduct) => {
    const stock = stockByProduct.get(product.id) ?? 0;

    if (stock <= 0) {
      toast.error("Producto sin existencia");
      return;
    }

    const inCart =
      getCartItems().find((item) => item.productId === product.id)?.quantity ??
      0;

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
          "No hay sucursal activa para el pedido online. Contacta a la tienda.",
        );
      }

      const cart = getCartItems();

      if (!cart.length) {
        throw new Error("El carrito está vacío");
      }

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
        "¡Pedido confirmado! Stock reservado del inventario compartido.",
      );

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
        queryKey: ["pos-variant-inventory-shared"],
      });
    },

    onError: (err: Error) => {
      toast.error(err.message || "No se pudo crear el pedido");
    },
  });

  const featured = useMemo(
    () =>
      products
        .filter((product) => product.available && product.image_url)
        .slice(0, 4),
    [products],
  );

  const categoryTiles = useMemo(() => {
    const tiles: { name: string; image: string | null }[] = [];

    for (const name of storeCategories) {
      if (name === "Todos") continue;
      const withImage = products.find(
        (product) => product.category === name && product.image_url,
      );
      tiles.push({ name, image: withImage?.image_url ?? null });
      if (tiles.length >= 4) break;
    }

    return tiles;
  }, [products, storeCategories]);

  const activeBanners = useMemo(
    () =>
      config.banners
        .filter((banner) => banner.active)
        .sort((a, b) => a.order - b.order)
        .slice(0, 2),
    [config.banners],
  );

  const goToCategory = (name: string) => {
    setCategory(name);
    document
      .getElementById("catalogo")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remainingForFreeShipping = Math.max(
    0,
    theme.freeShippingFrom - cartTotal,
  );

  return (
    <div
      className="min-h-screen text-slate-900"
      style={
        {
          backgroundColor: theme.background,
          "--store-primary": theme.primary,
        } as CSSProperties
      }
    >
      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        categories={storeCategories}
        activeCategory={category}
        onSelectCategory={setCategory}
      />

      <main>
        {/* Portada */}
        <section
          className="relative isolate overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${theme.background} 0%, #ffffff 55%, ${theme.primary}1f 100%)`,
          }}
        >
          {HERO_IMAGE_URL && (
            <>
              <img
                src={HERO_IMAGE_URL}
                alt=""
                className="absolute inset-0 -z-20 h-full w-full object-cover"
              />
              <div className="absolute inset-0 -z-10 bg-white/55" />
            </>
          )}

          <div className="mx-auto max-w-[1400px] px-4 py-14 text-center sm:px-6 sm:py-24 lg:px-8">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.3em] sm:text-xs"
              style={{ color: theme.primary }}
            >
              {theme.trustLine}
            </p>

            <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              {theme.heroTitle}
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-sm text-slate-600 sm:text-base">
              {theme.heroSubtitle}
            </p>

            <a
              href="#catalogo"
              className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-md transition hover:opacity-90"
              style={{ backgroundColor: theme.primary }}
            >
              {theme.heroCta}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <div className="mx-auto max-w-[1400px] px-3 pb-16 sm:px-6 lg:px-8">
          {/* Beneficios */}
          <section className="grid grid-cols-1 gap-3 py-6 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(139,58,92,0.06)]">
              <Truck
                className="h-5 w-5 shrink-0"
                style={{ color: theme.primary }}
              />
              <div>
                <p className="text-sm font-semibold">Envíos disponibles</p>
                <p className="text-xs text-slate-500">{theme.shippingNote}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(139,58,92,0.06)]">
              <Package
                className="h-5 w-5 shrink-0"
                style={{ color: theme.primary }}
              />
              <div>
                <p className="text-sm font-semibold">Existencias actualizadas</p>
                <p className="text-xs text-slate-500">
                  Consulta del inventario de la tienda
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(139,58,92,0.06)]">
              <ShieldCheck
                className="h-5 w-5 shrink-0"
                style={{ color: theme.primary }}
              />
              <div>
                <p className="text-sm font-semibold">Atención Lula Shop</p>
                <p className="text-xs text-slate-500">
                  Estamos para ayudarte con tu compra
                </p>
              </div>
            </div>
          </section>

          {/* Categorías en mosaico (con fotos de tus propios productos) */}
          {categoryTiles.length > 0 && (
            <section className="pt-6 sm:pt-10">
              <p
                className="text-center text-[11px] font-bold uppercase tracking-[0.3em]"
                style={{ color: theme.primary }}
              >
                Explora por categoría
              </p>
              <h2 className="mt-2 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
                Tu próxima creación empieza aquí
              </h2>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {categoryTiles.map((tile) => (
                  <button
                    key={tile.name}
                    type="button"
                    onClick={() => goToCategory(tile.name)}
                    className="group relative aspect-[4/5] overflow-hidden rounded-3xl text-left shadow-[0_4px_20px_rgba(139,58,92,0.1)]"
                    style={{
                      background: `linear-gradient(160deg, ${theme.primary}33, ${theme.secondary}55)`,
                    }}
                  >
                    {tile.image && (
                      <img
                        src={tile.image}
                        alt={tile.name}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-4">
                      <p className="text-lg font-bold text-white sm:text-xl">
                        {tile.name}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90">
                        Ver todo <ArrowRight className="h-3 w-3" />
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Selección destacada */}
          {featured.length > 0 && (
            <section className="pt-12 sm:pt-16">
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.3em]"
                    style={{ color: theme.primary }}
                  >
                    Pequeños detalles, grandes ideas
                  </p>
                  <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                    Selección Lula Shop
                  </h2>
                </div>
                <a
                  href="#catalogo"
                  className="text-xs font-bold uppercase tracking-[0.16em]"
                  style={{ color: theme.primary }}
                >
                  Ver todo
                </a>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {featured.map((product) => (
                  <StoreProductCard
                    key={product.id}
                    product={product}
                    onAdd={handleAdd}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Banners de promoción (se editan en Pedidos → Config tienda) */}
          {activeBanners.length > 0 && (
            <section className="grid gap-3 pt-12 sm:grid-cols-2 sm:gap-4 sm:pt-16">
              {activeBanners.map((banner) => (
                <a
                  key={banner.id}
                  href={banner.ctaLink || "#catalogo"}
                  className="group flex min-h-[170px] flex-col justify-center rounded-3xl p-6 shadow-[0_4px_20px_rgba(139,58,92,0.1)] sm:min-h-[220px] sm:p-10"
                  style={{
                    backgroundColor: banner.bgColor,
                    color: banner.textColor,
                  }}
                >
                  <h3 className="text-2xl font-extrabold leading-tight sm:text-3xl">
                    {banner.title}
                  </h3>
                  {banner.subtitle && (
                    <p className="mt-2 text-sm opacity-90">{banner.subtitle}</p>
                  )}
                  {banner.ctaText && (
                    <span className="mt-5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]">
                      {banner.ctaText}
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                    </span>
                  )}
                </a>
              ))}
            </section>
          )}

          {/* Catálogo */}
          <section id="catalogo" className="scroll-mt-32 pt-12 sm:pt-16">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                  Nuestro catálogo
                </h2>
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isFetching ? "animate-pulse bg-amber-400" : "bg-emerald-500"
                    }`}
                  />
                  {filtered.length} productos encontrados
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={showOutOfStock}
                    onChange={(event) => setShowOutOfStock(event.target.checked)}
                    style={{ accentColor: theme.primary }}
                  />
                  Mostrar agotados
                </label>

                <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2">
                  <SlidersHorizontal
                    className="h-4 w-4"
                    style={{ color: theme.primary }}
                  />
                  <span className="text-xs text-slate-500">Ordenar:</span>
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as SortOption)
                    }
                    className="max-w-[155px] bg-transparent text-xs font-medium text-slate-800 outline-none"
                    aria-label="Ordenar productos"
                  >
                    <option value="recommended">Recomendados</option>
                    <option value="name-asc">Nombre: A a Z</option>
                    <option value="name-desc">Nombre: Z a A</option>
                    <option value="price-asc">Precio: menor a mayor</option>
                    <option value="price-desc">Precio: mayor a menor</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Categorías */}
            <nav
              aria-label="Categorías de productos"
              className="mb-6 flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {storeCategories.map((cat) => {
                const active = category === cat;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className="shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition sm:text-sm"
                    style={
                      active
                        ? {
                            borderColor: theme.primary,
                            backgroundColor: theme.primary,
                            color: "#fff",
                          }
                        : {
                            borderColor: `${theme.primary}33`,
                            backgroundColor: "#fff",
                            color: "#475569",
                          }
                    }
                  >
                    {cat}
                  </button>
                );
              })}
            </nav>

            {/* Estado de carga */}
            {loadingInventory && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={index}
                    className="animate-pulse overflow-hidden rounded-2xl bg-white"
                  >
                    <div className="aspect-square bg-rose-50" />
                    <div className="space-y-3 p-3">
                      <div className="h-3 w-2/3 rounded bg-rose-100" />
                      <div className="h-4 w-full rounded bg-rose-100" />
                      <div className="h-8 rounded-full bg-rose-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {!loadingInventory && isError && (
              <div className="rounded-3xl bg-white px-5 py-12 text-center">
                <Package className="mx-auto h-10 w-10 text-rose-300" />
                <h3 className="mt-4 font-semibold text-slate-800">
                  No pudimos cargar el catálogo
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Intenta actualizar la página o vuelve a intentarlo.
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                  style={{ backgroundColor: theme.primary }}
                >
                  <RefreshCw className="h-4 w-4" />
                  Volver a cargar
                </button>
              </div>
            )}

            {/* Sin resultados */}
            {!loadingInventory && !isError && filtered.length === 0 && (
              <div className="rounded-3xl border border-dashed border-rose-200 bg-white px-5 py-16 text-center">
                <Package className="mx-auto h-10 w-10 text-rose-300" />
                <h3 className="mt-4 font-semibold text-slate-800">
                  No encontramos productos
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Prueba con otra búsqueda o selecciona una categoría diferente.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategory("Todos");
                    setShowOutOfStock(false);
                  }}
                  className="mt-5 rounded-full border px-5 py-2 text-sm font-semibold"
                  style={{ borderColor: theme.primary, color: theme.primary }}
                >
                  Limpiar filtros
                </button>
              </div>
            )}

            {/* Productos */}
            {!loadingInventory && !isError && visibleProducts.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                  {visibleProducts.map((product) => (
                    <StoreProductCard
                      key={product.id}
                      product={product}
                      onAdd={handleAdd}
                    />
                  ))}
                </div>

                {/* Paginación */}
                {totalPages > 1 && (
                  <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => {
                        setPage((value) => Math.max(1, value - 1));
                        document
                          .getElementById("catalogo")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="flex h-10 items-center gap-1 rounded-full border border-black/10 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </button>

                    <span className="px-3 text-sm text-slate-500">
                      Página {currentPage} de {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => {
                        setPage((value) => Math.min(totalPages, value + 1));
                        document
                          .getElementById("catalogo")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="flex h-10 items-center gap-1 rounded-full border border-black/10 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-40"
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Preguntas frecuentes */}
          <section id="preguntas" className="mx-auto mt-14 max-w-3xl scroll-mt-32">
            <p
              className="text-center text-[11px] font-bold uppercase tracking-[0.3em]"
              style={{ color: theme.primary }}
            >
              Estamos para ayudarte
            </p>
            <h2 className="mt-2 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
              Antes de hacer tu pedido
            </h2>

            <div className="mt-6 space-y-3">
              {[
                {
                  q: "¿Cómo se actualizan las existencias?",
                  a: "El catálogo consulta las existencias disponibles del sistema periódicamente. La disponibilidad final se vuelve a validar al intentar realizar el pedido.",
                },
                {
                  q: "¿Cómo recibo mi compra?",
                  a: "Puedes indicar tus datos y dirección en el carrito. La tienda confirmará contigo los detalles de entrega.",
                },
                {
                  q: "¿Cuánto cuesta el envío?",
                  a: `${theme.shippingNote}. ${theme.freeShippingText}.`,
                },
                {
                  q: "¿Necesitas ayuda?",
                  a: "Ponte en contacto con Lula Shop para resolver cualquier duda sobre productos y pedidos.",
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(139,58,92,0.06)]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-slate-500">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Pie de página */}
      <footer
        className="px-4 py-12 text-center text-white"
        style={{ backgroundColor: theme.secondary }}
      >
        <p className="text-xl font-extrabold uppercase tracking-[0.18em]">
          Lula Shop
        </p>
        <p className="mt-2 text-sm text-white/80">{theme.footerText}</p>

        {WHATSAPP_NUMBER && (
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-bold uppercase tracking-[0.16em]"
            style={{ color: theme.secondary }}
          >
            <MessageCircle className="h-4 w-4" />
            Hablemos por WhatsApp
          </a>
        )}

        <p className="mt-6 text-[11px] text-white/60">
          Productos profesionales · Tienda en línea
        </p>
      </footer>

      {/* Carrito existente */}
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
            items.find((item) => item.productId === id)?.quantity ?? 0;
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
            items.find((item) => item.productId === id)?.quantity ?? 0;

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
