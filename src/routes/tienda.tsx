
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  Filter,
  ArrowRight,
  MapPin,
  Phone,
  ShoppingBag,
  CreditCard,
  Truck,
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
  DEFAULT_STORE_CONFIG,
} from "@/lib/store/storeConfig";
import {
  getStorePublicData,
  createStoreOnlineOrder,
} from "@/lib/store/store.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/tienda")({
  head: () => ({
    meta: [
      { title: "Lula Shop | Tienda en línea" },
      {
        name: "description",
        content:
          "Explora el catálogo de Lula Shop, consulta existencias y crea tu pedido en línea.",
      },
      { property: "og:title", content: "Lula Shop | Tienda en línea" },
      {
        property: "og:description",
        content: "Explora el catálogo real de Lula Shop y crea tu pedido en línea.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
  category_id: string | null;
  price: number;
  image_url: string | null;
  emoji: string | null;
  has_variants: boolean;
  available_stock: number;
};

type SortOption =
  | "recommended"
  | "name-asc"
  | "name-desc"
  | "price-asc"
  | "price-desc";

const PAGE_SIZE = 40;

function mapCatalog(
  rows: OnlineCatalogRow[],
  categoryById: Map<string, string>,
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
      description:
        row.description?.trim() ||
        (row.sku ? `SKU: ${row.sku}` : undefined),
      stock,
    };
  });
}

function TiendaPage() {
  const qc = useQueryClient();

  const [config, setConfig] = useState<StoreConfig>(
    DEFAULT_STORE_CONFIG,
  );

  useEffect(() => {
    setConfig(loadStoreConfig());
    return subscribeStoreConfig(() =>
      setConfig(loadStoreConfig()),
    );
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

  // Catálogo, categorías y sucursales consultados desde el servidor.
  const {
    data: storeData,
    isLoading: loadingInventory,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["online-catalog", "tienda-publica"],
    queryFn: () => getStorePublicData(),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const onlineBranchId = storeData?.onlineBranchId ?? null;
  const contactBranches = storeData?.branches ?? [];
  const contactError = isError;

  const products = useMemo(() => {
    if (!storeData) return [];

    const categoryById = new Map(
      storeData.categories.map((item) => [
        item.id,
        item.name,
      ]),
    );

    return mapCatalog(
      storeData.rows,
      categoryById,
    );
  }, [storeData]);

  const categories = useMemo(() => {
    const names = new Set(
      products.map((product) => product.category).filter(Boolean),
    );

    return [
      "Todos",
      ...Array.from(names).sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    ];
  }, [products]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();

    products.forEach((product) => {
      map.set(product.id, product.stock);
    });

    return map;
  }, [products]);

  const priceBounds = useMemo(() => {
    const prices = products.map((product) => product.price);

    return {
      min: prices.length
        ? Math.floor(Math.min(...prices))
        : 0,
      max: prices.length
        ? Math.ceil(Math.max(...prices))
        : 1000,
    };
  }, [products]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    const min = minPrice.trim() ? Number(minPrice) : 0;
    const max = maxPrice.trim()
      ? Number(maxPrice)
      : Number.POSITIVE_INFINITY;

    const result = products.filter((product) => {
      const matchesSearch =
        !query ||
        product.name.toLocaleLowerCase("es").includes(query) ||
        (product.description || "")
          .toLocaleLowerCase("es")
          .includes(query) ||
        product.category
          .toLocaleLowerCase("es")
          .includes(query);

      const matchesCategory =
        category === "Todos" ||
        product.category === category;

      const matchesStock =
        showOutOfStock || product.available;

      const matchesPrice =
        product.price >= min &&
        product.price <= max;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStock &&
        matchesPrice
      );
    });

    switch (sort) {
      case "name-asc":
        result.sort((a, b) =>
          a.name.localeCompare(b.name, "es"),
        );
        break;

      case "name-desc":
        result.sort((a, b) =>
          b.name.localeCompare(a.name, "es"),
        );
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
    products,
    search,
    category,
    showOutOfStock,
    minPrice,
    maxPrice,
    sort,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / PAGE_SIZE),
  );

  const currentPage = Math.min(page, totalPages);

  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    category,
    sort,
    showOutOfStock,
    minPrice,
    maxPrice,
  ]);

  const handleAdd = (
    product: StoreProduct,
    quantity = 1,
  ) => {
    const stock = stockByProduct.get(product.id) ?? 0;

    const existing =
      getCartItems().find(
        (item) => item.productId === product.id,
      )?.quantity ?? 0;

    if (stock <= 0 || existing + quantity > stock) {
      toast.error(
        `Existencia insuficiente. Disponible: ${stock}`,
      );
      return;
    }

    addToCart(product, quantity);
    refreshCart();

    toast.success(
      `${quantity} pieza(s) agregadas al carrito`,
    );
  };

  // El pedido se crea en el servidor.
  // Los precios y nombres se vuelven a consultar allí.
  const placeOrder = useMutation({
    mutationFn: async () => {
      if (!onlineBranchId) {
        throw new Error(
          "No hay sucursal activa para el pedido online.",
        );
      }

      const cart = getCartItems();

      if (!cart.length) {
        throw new Error("El carrito está vacío");
      }

      return createStoreOnlineOrder({
        data: {
          branchId: onlineBranchId,
          customerName,
          customerPhone,
          address,
          notes,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      });
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

      void qc.invalidateQueries({
        queryKey: ["online-catalog"],
      });

      void qc.invalidateQueries({
        queryKey: ["online-orders"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-products-shared"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-variant-inventory-shared"],
      });
    },

    onError: (error: Error) => {
      toast.error(
        error.message || "No se pudo crear el pedido",
      );
    },
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
    setPage(
      Math.max(1, Math.min(totalPages, next)),
    );

    document
      .getElementById("catalogo")
      ?.scrollIntoView({
        behavior: window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  };

  const renderFilters = () => (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold">
          Categorías
        </h3>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={
                category === cat ? "secondary" : "ghost"
              }
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className="h-auto min-h-9 w-full justify-start whitespace-normal rounded px-3 py-2 text-left text-xs"
            >
              {cat}
            </Button>
          ))}
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-semibold">
          Precio
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Desde
            <Input
              type="number"
              min="0"
              step="0.01"
              value={minPrice}
              onChange={(e) =>
                setMinPrice(e.target.value)
              }
              placeholder={String(priceBounds.min)}
              className="mt-2 h-10 rounded"
            />
          </label>

          <label className="text-xs text-muted-foreground">
            Hasta
            <Input
              type="number"
              min="0"
              step="0.01"
              value={maxPrice}
              onChange={(e) =>
                setMaxPrice(e.target.value)
              }
              placeholder={String(priceBounds.max)}
              className="mt-2 h-10 rounded"
            />
          </label>
        </div>

        {minPrice &&
          maxPrice &&
          Number(minPrice) > Number(maxPrice) && (
            <p
              role="status"
              className="mt-2 text-xs text-destructive"
            >
              El precio mínimo supera al máximo.
            </p>
          )}
      </section>

      <section className="border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-semibold">
          Disponibilidad
        </h3>

        <label className="flex cursor-pointer items-start gap-2 text-xs leading-5">
          <input
            type="checkbox"
            checked={showOutOfStock}
            onChange={(e) =>
              setShowOutOfStock(e.target.checked)
            }
            className="mt-1 accent-primary"
          />
          Mostrar también agotados
        </label>
      </section>

      <Button
        variant="outline"
        onClick={resetFilters}
        className="w-full rounded-full text-xs"
      >
        Borrar filtros
      </Button>
    </div>
  );

  const heroTitle =
    theme.heroTitle?.trim() || "Lula Shop";

  const heroSubtitle =
    theme.heroSubtitle !==
    DEFAULT_STORE_CONFIG.theme.heroSubtitle
      ? theme.heroSubtitle
      : "";

  const footerText =
    theme.footerText ||
    DEFAULT_STORE_CONFIG.theme.footerText;

  return (
    <div
      id="inicio"
      className="lula-store min-h-screen bg-background text-foreground"
    >
      <style>{`
        .lula-store, .store-filters {
          --primary: #b5276b;
          --primary-foreground: #ffffff;
          --background: #ffffff;
          --foreground: #30232b;
          --card: #ffffff;
          --card-foreground: #30232b;
          --secondary: #fceaf2;
          --secondary-foreground: #872354;
          --muted: #f7f4f6;
          --muted-foreground: #75646e;
          --accent: #fceaf2;
          --accent-foreground: #872354;
          --border: #efdee6;
          --input: #dfcad4;
          --ring: #b5276b;
          --destructive: #b42338;
          --store-banner: #f5c7dd;
          letter-spacing: 0;
        }

        .lula-store section[id],
        .lula-store footer[id] {
          scroll-margin-top: 220px;
        }

        .lula-store .store-banner {
          background: var(--store-banner);
        }

        .lula-store ::selection {
          background: var(--secondary);
          color: var(--foreground);
        }
      `}</style>

      <StoreHeader
        search={search}
        onSearchChange={setSearch}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        categories={categories}
        activeCategory={category}
        onSelectCategory={setCategory}
      />

      <main>
        <section className="store-banner border-b border-border px-5 py-12 text-center sm:px-8 sm:py-16">
          <h1 className="mx-auto max-w-3xl break-words font-serif text-4xl font-medium leading-tight sm:text-5xl">
            Lula Shop
          </h1>

          <p className="mx-auto mt-4 max-w-2xl break-words text-lg leading-relaxed">
            {heroTitle}
          </p>

          {heroSubtitle && (
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed">
              {heroSubtitle}
            </p>
          )}

          <Button
            asChild
            className="mt-7 h-11 rounded-full px-7"
          >
            <a href="#catalogo">
              {theme.heroCta || "Ver productos"}
              <ArrowRight />
            </a>
          </Button>
        </section>

        <div className="mx-auto grid max-w-[1440px] gap-4 border-b border-border px-5 py-5 text-xs sm:grid-cols-3 sm:px-8 lg:px-10">
          {[
            [ShoppingBag, "Catálogo con existencias disponibles"],
            [CreditCard, "Transferencia o pago al recibir"],
            [Truck, "Recoger en sucursal o envío a domicilio"],
          ].map(([Icon, text]) => {
            const ItemIcon = Icon as typeof ShoppingBag;

            return (
              <div
                key={String(text)}
                className="flex items-center justify-center gap-2"
              >
                <ItemIcon className="h-4 w-4 shrink-0 text-primary" />
                <span>{String(text)}</span>
              </div>
            );
          })}
        </div>

        <section
          id="catalogo"
          className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-12 lg:px-10"
        >
          <div
            className="mb-6 flex gap-2 overflow-x-auto pb-3"
            aria-label="Categorías de productos"
          >
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={
                  category === cat ? "default" : "outline"
                }
                size="sm"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className="shrink-0 rounded-full"
              >
                {cat}
              </Button>
            ))}
          </div>

          <div className="mb-7 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Lula Shop / Catálogo
              </p>

              <h2 className="font-serif text-3xl">
                {category === "Todos"
                  ? "Productos"
                  : category}
              </h2>

              <p
                role="status"
                className="mt-2 text-xs text-muted-foreground"
              >
                {loadingInventory
                  ? "Cargando catálogo…"
                  : isError
                    ? "Catálogo no disponible"
                    : `${filtered.length} productos encontrados`}

                {!loadingInventory && isFetching
                  ? " · Actualizando"
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setMobileFiltersOpen(true)
                }
                className="rounded-full text-xs lg:hidden"
              >
                <Filter />
                Filtros
              </Button>

              <label className="flex min-w-0 items-center gap-2 rounded-full border border-border px-3 py-2">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />

                <span className="sr-only">
                  Ordenar productos
                </span>

                <select
                  value={sort}
                  onChange={(e) =>
                    setSort(
                      e.target.value as SortOption,
                    )
                  }
                  className="min-w-0 max-w-48 bg-background text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="recommended">
                    Nombre: A a Z
                  </option>
                  <option value="price-asc">
                    Precio: menor a mayor
                  </option>
                  <option value="price-desc">
                    Precio: mayor a menor
                  </option>
                  <option value="name-asc">
                    A - Z
                  </option>
                  <option value="name-desc">
                    Z - A
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[190px_minmax(0,1fr)]">
            <aside
              aria-label="Filtros de productos"
              className="hidden border-r border-border pr-5 lg:block"
            >
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold">
                <Filter className="h-4 w-4 text-primary" />
                Filtros
              </h2>

              {renderFilters()}
            </aside>

            <div
              className="min-w-0"
              aria-busy={isFetching}
            >
              {loadingInventory && (
                <div
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
                  aria-label="Cargando productos"
                >
                  {Array.from({ length: 8 }).map(
                    (_, i) => (
                      <div
                        key={i}
                        className="overflow-hidden rounded-lg border border-border motion-safe:animate-pulse"
                      >
                        <div className="aspect-square bg-secondary" />

                        <div className="space-y-3 p-4">
                          <div className="h-3 w-1/2 bg-muted" />
                          <div className="h-5 bg-muted" />
                          <div className="h-10 bg-muted" />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}

              {!loadingInventory && isError && (
                <div
                  role="alert"
                  className="py-16 text-center"
                >
                  <Package className="mx-auto h-10 w-10 text-primary" />

                  <h3 className="mt-4 text-lg font-semibold">
                    No pudimos cargar los productos
                  </h3>

                  <p className="mt-2 text-sm text-muted-foreground">
                    Intenta consultar el catálogo nuevamente.
                  </p>

                  <Button
                    onClick={() => void refetch()}
                    className="mt-5 rounded-full"
                  >
                    <RefreshCw />
                    Volver a cargar
                  </Button>
                </div>
              )}

              {!loadingInventory &&
                !isError &&
                filtered.length === 0 && (
                  <div className="py-16 text-center">
                    <Package className="mx-auto h-10 w-10 text-primary" />

                    <h3 className="mt-4 text-lg font-semibold">
                      No encontramos productos
                    </h3>

                    <p className="mt-2 text-sm text-muted-foreground">
                      Prueba otra búsqueda o cambia los filtros.
                    </p>

                    <Button
                      onClick={resetFilters}
                      className="mt-5 rounded-full"
                    >
                      Borrar filtros
                    </Button>
                  </div>
                )}

              {!loadingInventory &&
                !isError &&
                visibleProducts.length > 0 && (
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

                    <nav
                      aria-label="Paginación del catálogo"
                      className="mt-8 flex flex-wrap items-center justify-center gap-3"
                    >
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Página anterior"
                        disabled={currentPage <= 1}
                        onClick={() =>
                          changePage(currentPage - 1)
                        }
                        className="rounded-full"
                      >
                        <ChevronLeft />
                      </Button>

                      <span className="text-xs text-muted-foreground">
                        Página {currentPage} de {totalPages}
                      </span>

                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Página siguiente"
                        disabled={
                          currentPage >= totalPages
                        }
                        onClick={() =>
                          changePage(currentPage + 1)
                        }
                        className="rounded-full"
                      >
                        <ChevronRight />
                      </Button>
                    </nav>
                  </>
                )}
            </div>
          </div>
        </section>

        <section
          id="como-comprar"
          className="border-y border-border bg-secondary px-5 py-12 sm:py-16"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-center text-xs font-semibold uppercase text-primary">
              Tu pedido, paso a paso
            </p>

            <h2 className="mt-3 text-center font-serif text-3xl">
              ¿Cómo comprar en Lula Shop?
            </h2>

            <div className="mt-9 grid gap-8 sm:grid-cols-3">
              {[
                [
                  "01",
                  "Elige tus productos",
                  "Busca en el catálogo y selecciona las cantidades disponibles.",
                ],
                [
                  "02",
                  "Completa tu pedido",
                  "Revisa tu carrito, agrega tus datos y elige pago y modalidad de entrega.",
                ],
                [
                  "03",
                  "Envía tu pedido",
                  "Confirma tu pedido. Para resolver detalles de pago o entrega, contacta a la tienda.",
                ],
              ].map(([n, title, description]) => (
                <div
                  key={n}
                  className="border-t border-primary/20 pt-5"
                >
                  <span className="font-serif text-3xl text-primary">
                    {n}
                  </span>

                  <h3 className="mt-3 text-base font-semibold">
                    {title}
                  </h3>

                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="preguntas"
          className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1fr_2fr]"
        >
          <div>
            <p className="text-xs font-semibold uppercase text-primary">
              Antes de pedir
            </p>

            <h2 className="mt-3 font-serif text-3xl">
              Preguntas frecuentes
            </h2>
          </div>

          <div>
            {[
              [
                "¿Las existencias están actualizadas?",
                "El catálogo consulta periódicamente las existencias disponibles y las vuelve a comprobar antes de enviar el pedido.",
              ],
              [
                "¿Cómo puedo pagar?",
                "En el carrito puedes elegir transferencia bancaria o pago al recoger o recibir. No se realiza un cobro con tarjeta en esta tienda.",
              ],
              [
                "¿Cómo elijo la entrega?",
                "El carrito ofrece recoger en sucursal o envío a domicilio. Para envío, debes completar la dirección. Consulta con la tienda los costos y tiempos; no se calculan aquí.",
              ],
              [
                "¿Puedo elegir una sucursal?",
                "Actualmente el pedido se asigna automáticamente a una sucursal activa. Antes de ir a recogerlo, confirma el punto de entrega con la tienda.",
              ],
              [
                "¿Qué datos necesito?",
                "Tu nombre y teléfono. Si solicitas envío, también tu dirección. Puedes agregar indicaciones en las notas del pedido.",
              ],
            ].map(([question, answer]) => (
              <details
                key={question}
                className="group border-b border-border py-4"
              >
                <summary className="cursor-pointer text-sm font-semibold text-foreground">
                  {question}
                </summary>

                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section
          id="contacto"
          className="border-t border-border bg-muted px-5 py-12"
        >
          <div className="mx-auto max-w-6xl">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase text-primary">
                Estamos en contacto
              </p>

              <h2 className="mt-3 font-serif text-3xl">
                Sucursales Lula Shop
              </h2>
            </div>

            {contactBranches.length ? (
              <div className="grid gap-8 sm:grid-cols-2">
                {contactBranches.map((branch) => (
                  <div
                    key={branch.id}
                    className="border-t border-border pt-5"
                  >
                    <h3 className="mb-3 text-lg font-semibold">
                      {branch.name.trim()}
                    </h3>

                    {branch.address?.trim() && (
                      <p className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {branch.address.trim()}
                      </p>
                    )}

                    {branch.phone?.trim() && (
                      <a
                        href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}
                        className="mt-3 flex w-fit items-center gap-2 text-sm text-primary underline underline-offset-4"
                      >
                        <Phone className="h-4 w-4" />
                        {branch.phone.trim()}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {contactError
                  ? "No pudimos consultar los datos de contacto en este momento."
                  : "Consultando sucursales…"}
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-10">
        <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-3">
          <div>
            <a
              href="#inicio"
              className="font-serif text-3xl font-bold italic text-primary"
            >
              Lula Shop
            </a>

            <p className="mt-3 text-xs text-muted-foreground">
              {footerText}
            </p>
          </div>

          <nav
            aria-label="Navegación del pie de página"
            className="grid gap-3 text-sm"
          >
            <a href="#catalogo">Productos</a>
            <a href="#como-comprar">¿Cómo comprar?</a>
            <a href="#preguntas">Preguntas frecuentes</a>
            <a href="#contacto">Contacto y sucursales</a>
          </nav>

          <div>
            <h3 className="mb-3 text-sm font-semibold">
              Contacto
            </h3>

            {contactBranches.map((branch) => (
              <div
                key={branch.id}
                className="mb-3 text-xs text-muted-foreground"
              >
                <a href="#contacto">
                  {branch.name.trim()}
                </a>

                {branch.phone?.trim() && (
                  <a
                    href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}
                    className="mt-1 block text-primary"
                  >
                    {branch.phone.trim()}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-6xl border-t border-border pt-5 text-xs text-muted-foreground">
          Lula Shop · Tienda en línea
        </div>
      </footer>

      <Sheet
        open={mobileFiltersOpen}
        onOpenChange={setMobileFiltersOpen}
      >
        <SheetContent className="store-filters flex w-[90%] flex-col bg-background text-foreground sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>
              Precio, categoría y disponibilidad
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-6">
            {renderFilters()}
          </div>

          <Button
            onClick={() => setMobileFiltersOpen(false)}
            className="rounded-full"
          >
            Ver {filtered.length} productos
          </Button>
        </SheetContent>
      </Sheet>

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
            items.find((item) => item.productId === id)
              ?.quantity ?? 0;

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
            items.find((item) => item.productId === id)
              ?.quantity ?? 0;

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
