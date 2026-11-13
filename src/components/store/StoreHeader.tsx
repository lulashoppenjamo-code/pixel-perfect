
import { useState } from "react";
import { Search, ShoppingBag, Menu, X, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type StoreHeaderProps = {
  search: string;
  onSearchChange: (value: string) => void;
  cartCount: number;
  onOpenCart: () => void;
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
  activeCategory,
  onSelectCategory,
}: StoreHeaderProps) {
  const [mobileMenu, setMobileMenu] = useState(false);

  const links = [
    ["Inicio", "#inicio"],
    ["Productos", "#catalogo"],
    ["¿Cómo comprar?", "#como-comprar"],
    ["Preguntas frecuentes", "#preguntas"],
    ["Contacto", "#contacto"],
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[#f0dce5] bg-white text-[#34232c] shadow-[0_2px_12px_rgba(117,42,77,0.045)]">
      <div className="bg-[#f7dce8] px-3 py-2 text-center text-[10px] font-semibold tracking-[0.12em] text-[#78364f] sm:text-xs">
        BELLEZA, ACCESORIOS Y TUS FAVORITOS · LULA SHOP
      </div>

      <div className="mx-auto grid max-w-[1500px] grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8 lg:px-10 lg:py-5">
        <div className="relative hidden max-w-[360px] lg:block">
          <Search
            aria-hidden="true"
            className="absolute left-4 top-3.5 h-4 w-4 text-[#a34d70]"
          />
          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-11 rounded-full border-[#ead5df] bg-[#fff9fb] pl-11 pr-10 text-sm placeholder:text-[#a58c98] focus-visible:ring-[#c65c89]"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSearchChange("")}
              aria-label="Borrar búsqueda"
              className="absolute right-1 top-1 rounded-full text-[#a34d70]"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <a
          href="#inicio"
          className="w-fit text-center text-[#a83f6c] lg:justify-self-center"
          aria-label="Lula Shop, inicio"
        >
          <span className="block font-serif text-[30px] font-bold italic leading-none tracking-[-0.045em] sm:text-4xl">
            Lula Shop
          </span>
          <span className="mt-1.5 block text-[9px] font-semibold uppercase tracking-[0.28em] text-[#987282]">
            Belleza · Estilo · Detalles
          </span>
        </a>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileMenu ? "Cerrar navegación" : "Abrir navegación"}
            aria-expanded={mobileMenu}
            aria-controls="store-mobile-nav"
            onClick={() => setMobileMenu(!mobileMenu)}
            className="text-[#a83f6c] md:hidden"
          >
            {mobileMenu ? <X /> : <Menu />}
          </Button>

          <Button
            onClick={onOpenCart}
            aria-label={`Abrir carrito, ${cartCount} piezas`}
            className="h-10 rounded-full bg-[#a83f6c] px-4 text-white shadow-sm hover:bg-[#873254]"
          >
            <ShoppingBag className="h-4 w-4" />
            <span className="hidden sm:inline">Mi carrito</span>
            <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-[#a83f6c]">
              {cartCount}
            </span>
          </Button>
        </div>

        <div className="relative col-span-2 lg:hidden">
          <Search
            aria-hidden="true"
            className="absolute left-3.5 top-3 h-4 w-4 text-[#a34d70]"
          />
          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-10 rounded-full border-[#ead5df] bg-[#fff9fb] pl-10 pr-10 text-sm placeholder:text-[#a58c98]"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Borrar búsqueda"
              onClick={() => onSearchChange("")}
              className="absolute right-0 top-0 rounded-full text-[#a34d70]"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <nav
        aria-label="Navegación de tienda"
        className="hidden items-center justify-center gap-7 border-t border-[#f4e8ee] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.11em] text-[#634653] md:flex"
      >
        {links.map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="whitespace-nowrap transition-colors hover:text-[#b34270]"
          >
            {label}
          </a>
        ))}
      </nav>

      {categories.length > 1 && (
        <nav
          aria-label="Categorías"
          className="hidden items-center justify-center gap-2 overflow-x-auto border-t border-[#f7edf1] px-5 py-2.5 xl:flex"
        >
          {categories.slice(0, 11).map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={activeCategory === cat}
              onClick={() => onSelectCategory?.(cat)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-[#a83f6c] text-white"
                  : "text-[#765766] hover:bg-[#fbedf3] hover:text-[#a83f6c]"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>
      )}

      {mobileMenu && (
        <nav
          id="store-mobile-nav"
          aria-label="Navegación móvil"
          className="max-h-[65dvh] overflow-y-auto border-t border-[#f0dce5] bg-white px-4 py-2 md:hidden"
        >
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileMenu(false)}
              className="flex items-center justify-between border-b border-[#f5eaf0] py-3 text-sm"
            >
              {label}
              <ArrowRight className="h-4 w-4 text-[#b34270]" />
            </a>
          ))}

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2 py-3">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={activeCategory === cat ? "default" : "outline"}
                  className="rounded-full border-[#e8cad8] text-xs"
                  onClick={() => {
                    onSelectCategory?.(cat);
                    setMobileMenu(false);
                    document
                      .getElementById("catalogo")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {cat}
                </Button>
              ))}
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
