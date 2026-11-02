
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
};

export function StoreHeader({
  search,
  onSearchChange,
  cartCount,
  onOpenCart,
}: StoreHeaderProps) {
  const config = loadStoreConfig();
  const theme = config.theme;
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full bg-white shadow-sm">
      {/* Barra promocional */}
      {theme.promoBarText && (
        <div
          className="flex min-h-8 items-center justify-center gap-2 px-3 py-2 text-center text-[10px] font-semibold tracking-wide text-white sm:text-xs"
          style={{ backgroundColor: theme.primary }}
        >
          <Truck className="h-3.5 w-3.5 shrink-0" />
          <span>
            {theme.promoBarText}
            {theme.freeShippingText ? ` · ${theme.freeShippingText}` : ""}
          </span>
        </div>
      )}

      {/* Cabecera principal */}
      <div className="border-b border-slate-100">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-3 sm:px-6 lg:px-8">
          {/* Marca */}
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
              <p className="truncate text-lg font-extrabold leading-tight tracking-tight text-slate-900 sm:text-xl">
                Lula Shop
              </p>
              <p className="hidden text-[10px] font-medium tracking-wide text-slate-400 sm:block">
                BELLEZA · UÑAS · ACCESORIOS
              </p>
            </div>
          </a>

          {/* Buscador para computadora */}
          <div className="relative hidden max-w-2xl flex-1 md:block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="¿Qué producto estás buscando?"
              className="h-11 rounded-full border-slate-200 bg-slate-50 pl-11 pr-4 text-sm shadow-none placeholder:text-slate-400 focus-visible:border-rose-300 focus-visible:ring-rose-200"
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
              className="h-10 w-10 rounded-full text-slate-600 hover:bg-rose-50 hover:text-rose-600 md:hidden"
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
              className="relative h-10 gap-2 rounded-full border-slate-200 bg-white px-3 text-slate-800 hover:border-rose-200 hover:bg-rose-50 sm:h-11 sm:px-4"
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

        {/* Buscador móvil desplegable */}
        {mobileSearchOpen && (
          <div className="border-t border-slate-100 bg-white px-3 py-3 md:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                autoFocus
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar productos..."
                className="h-11 rounded-full border-slate-200 bg-slate-50 pl-10 text-sm focus-visible:border-rose-300 focus-visible:ring-rose-200"
                aria-label="Buscar productos"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
