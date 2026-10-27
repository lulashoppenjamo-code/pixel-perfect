import { Search, ShoppingBag, Truck } from "lucide-react";
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

  return (
    <header className="sticky top-0 z-40 shadow-sm">
      {/* Promo bar */}
      <div
        className="flex items-center justify-center gap-2 px-4 py-2 text-center text-[11px] font-semibold tracking-wide text-white sm:text-xs"
        style={{ backgroundColor: theme.primary }}
      >
        <Truck className="hidden h-3.5 w-3.5 sm:block" />
        <span>
          {theme.promoBarText}
          {theme.freeShippingText ? ` · ${theme.freeShippingText}` : ""}
        </span>
      </div>

      <div className="border-b border-rose-100/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-4 sm:py-3.5">
          <a href="/tienda" className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-md"
              style={{
                background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
              }}
            >
              L
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-tight text-rose-950 sm:text-lg">
                Lula Shop
              </p>
              <p className="hidden text-[11px] text-rose-400 sm:block">
                Tienda profesional de uñas
              </p>
            </div>
          </a>

          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-rose-300" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar geles, acrílicos, herramientas…"
              className="h-11 rounded-full border-rose-100 bg-rose-50/60 pl-10 text-sm placeholder:text-rose-300 focus-visible:ring-rose-300"
              aria-label="Buscar productos"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onOpenCart}
            className="relative h-11 w-11 shrink-0 rounded-full border-rose-200 bg-white hover:bg-rose-50"
            aria-label={`Carrito, ${cartCount} artículos`}
          >
            <ShoppingBag className="h-5 w-5 text-rose-600" />
            {cartCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: theme.primary }}
              >
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}