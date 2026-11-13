
import { useState } from "react";
import { Search, ShoppingBag, Truck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadStoreConfig } from "@/lib/store/storeConfig";

type StoreHeaderProps = {
  search: string;
  onSearchChange: (value: string) => void;
  cartCount: number;
  onOpenCart: () => void;
  categories?: string[];
  activeCategory?: string;
  onSelectCategory?: (category: string) => void;
};

const pink = "#E95C9B";
const darkPink = "#C93678";

export function StoreHeader({
  search,
  onSearchChange,
  cartCount,
  onOpenCart,
}: StoreHeaderProps) {
  const config = loadStoreConfig();
  const [mobileSearch, setMobileSearch] = useState(false);

  const links = [
    ["Inicio", "/tienda"],
    ["Productos", "#catalogo"],
    ["¿Cómo comprar?", "#como-comprar"],
    ["Preguntas frecuentes", "#preguntas"],
    ["Contacto", "#contacto"],
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-white shadow-sm">
      <div
        className="flex min-h-9 items-center justify-center gap-2 px-3 py-2 text-center text-[10px] font-bold tracking-wide text-white sm:text-xs"
        style={{ backgroundColor: darkPink }}
      >
        <Truck className="h-3.5 w-3.5" />
        <span>{config.theme.promoBarText || "Bienvenida a Lula Shop"}</span>
      </div>

      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-3 py-4 sm:px-6 lg:px-8">
        <a href="/tienda" className="flex shrink-0 items-center gap-2">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full text-xl font-black text-white"
            style={{ background: `linear-gradient(135deg, ${pink}, ${darkPink})` }}
          >
            L
          </div>
          <div>
            <p className="text-lg font-black uppercase tracking-[0.12em] text-pink-800 sm:text-2xl">
              LULA SHOP
            </p>
            <p className="hidden text-[9px] font-semibold tracking-[0.2em] text-pink-400 sm:block">
              BELLEZA Y ACCESORIOS
            </p>
          </div>
        </a>

        <div className="relative mx-5 hidden max-w-2xl flex-1 md:block">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-pink-400" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-11 rounded-full border-pink-200 bg-pink-50/50 pl-11 text-sm"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileSearch((value) => !value)}
            className="text-pink-700 md:hidden"
            aria-label="Buscar"
          >
            {mobileSearch ? <X /> : <Search />}
          </Button>

          <Button
            type="button"
            onClick={onOpenCart}
            className="relative h-10 rounded-full px-3 text-white sm:px-5"
            style={{ backgroundColor: pink }}
          >
            <ShoppingBag className="mr-1.5 h-4 w-4" />
            <span>Carrito</span>
            <span>({cartCount})</span>
          </Button>
        </div>
      </div>

      {mobileSearch && (
        <div className="border-t border-pink-100 p-3 md:hidden">
          <Input
            autoFocus
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar productos..."
            className="rounded-full border-pink-200 bg-pink-50"
          />
        </div>
      )}

      <nav className="flex items-center justify-center gap-5 overflow-x-auto border-t border-pink-100 px-3 py-3 sm:gap-9">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-700 transition hover:text-pink-600 sm:text-xs"
          >
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}
