import { Search, ShoppingBag, Truck, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadStoreConfig } from "@/lib/store/storeConfig";

type StoreHeaderProps = {
  search: string;
  onSearchChange: (value: string) => void;
  cartCount: number;
  onOpenCart: () => void;
  /** Categorías reales del catálogo (incluye "Todos"). Opcional. */
  categories?: string[];
  activeCategory?: string;
  onSelectCategory?: (category: string) => void;
};

export function StoreHeader({
  search,
  onSearchChange,
  cartCount,
  onOpenCart,
  categories = [],
  activeCategory = "Todos",
  onSelectCategory,
}: StoreHeaderProps) {
  const config = loadStoreConfig();
  const theme = config.theme;
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const navItems = categories.slice(0, 8);

  const selectCategory = (cat: string) => {
    onSelectCategory?.(cat);
    document
      .getElementById("catalogo")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur">
      {/* Barra superior */}
      {theme.promoBarText && (
        <div
          className="flex min-h-8 items-center justify-center gap-2 px-3 py-2 text-center text-[10px] font-semibold tracking-wide text-white sm:text-xs"
          style={{ backgroundColor: theme.secondary }}
        >
          <Truck className="h-3.5 w-3.5 shrink-0" />
          <span>
            {theme.promoBarText}
            {theme.freeShippingText ? ` · ${theme.freeShippingText}` : ""}
          </span>
        </div>
      )}

      {/* Cabecera principal */}
      <div className="border-b" style={{ borderColor: `${theme.primary}22` }}>
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-3 sm:px-6 lg:px-8">
          <a
            href="/tienda"
            className="flex min-w-0 shrink-0 items-center gap-2.5"
            aria-label="Lula Shop, inicio"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white shadow-sm sm:h-11 sm:w-11"
              style={{
                background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
              }}
            >
              L
            </div>

            <div className="min-w-0">
              <p className="truncate text-lg font-extrabold uppercase leading-tight tracking-[0.12em] text-slate-900 sm:text-xl">
                Lula Shop
              </p>
              <p className="hidden text-[10px] font-medium tracking-[0.2em] text-slate-400 sm:block">
                BELLEZA PROFESIONAL
              </p>
            </div>
          </a>

          {/* Buscador computadora */}
          <div className="relative hidden max-w-xl flex-1 md:block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="¿Qué producto estás buscando?"
              className="h-11 rounded-full border-slate-200 bg-slate-50 pl-11 pr-4 text-sm shadow-none placeholder:text-slate-400"
              aria-label="Buscar productos"
            />
          </div>

          {/* Acciones */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileSearchOpen((open) => !open)}
              className="h-10 w-10 rounded-full text-slate-600 md:hidden"
              aria-label="Mostrar buscador"
            >
              {mobileSearchOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={onOpenCart}
              className="relative h-10 gap-2 rounded-full border-slate-200 bg-white px-3 text-slate-800 sm:h-11 sm:px-4"
              aria-label={`Abrir carrito, ${cartCount} artículos`}
            >
              <ShoppingBag className="h-5 w-5" />
              <span className="hidden text-sm font-semibold sm:inline">
                Carrito
              </span>

              {cartCount > 0 && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ backgroundColor: theme.primary }}
                >
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Buscador móvil */}
        {mobileSearchOpen && (
          <div className="border-t border-slate-100 bg-white px-3 py-3 md:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                autoFocus
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar productos..."
                className="h-11 rounded-full border-slate-200 bg-slate-50 pl-10 text-sm"
                aria-label="Buscar productos"
              />
            </div>
          </div>
        )}

        {/* Menú de categorías (reales, desde tu catálogo) */}
        {navItems.length > 1 && (
          <nav
            aria-label="Menú de categorías"
            className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:justify-center sm:px-6 [&::-webkit-scrollbar]:hidden"
          >
            {navItems.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => selectCategory(cat)}
                  className="shrink-0 border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition sm:text-xs"
                  style={{
                    borderColor: active ? theme.primary : "transparent",
                    color: active ? theme.primary : "#475569",
                  }}
                >
                  {cat === "Todos" ? "Catálogo" : cat}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
