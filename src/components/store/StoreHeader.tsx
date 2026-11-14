
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
    <header className="sticky top-0 z-40 border-b border-[#EBC9D9] bg-white text-[#34232C] shadow-[0_2px_12px_rgba(117,42,77,0.06)]">

      {/* Franja superior */}
      <div className="bg-[#B83272] px-3 py-2 text-center text-[10px] font-semibold tracking-[0.12em] text-white sm:text-xs">
        BELLEZA, ACCESORIOS Y TUS FAVORITOS · LULA SHOP
      </div>

      {/* Encabezado principal */}
      <div className="mx-auto grid max-w-[1500px] grid-cols-[1fr_auto] items-center gap-3 bg-gradient-to-r from-[#F7D6E5] via-[#EFAACB] to-[#E58AB8] px-4 py-3 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-8 lg:px-10 lg:py-5">

        {/* Buscador escritorio */}
        <div className="relative hidden max-w-[360px] lg:block">
          <Search
            aria-hidden="true"
            className="absolute left-4 top-3.5 h-4 w-4 text-[#A52E68]"
          />

          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-11 rounded-full border-white bg-white pl-11 pr-10 text-sm text-[#3D2A35] placeholder:text-[#8B6B7A] focus-visible:ring-[#B83272]"
          />

          {search && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSearchChange("")}
              aria-label="Borrar búsqueda"
              className="absolute right-1 top-1 rounded-full text-[#B83272]"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Logo */}
        <a
          href="#inicio"
          className="w-fit text-center text-[#382631] lg:justify-self-center"
          aria-label="Lula Shop, inicio"
        >
          <span className="block font-serif text-[30px] font-bold italic leading-none tracking-[-0.045em] sm:text-4xl">
            Lula Shop
          </span>

          <span className="mt-1.5 block text-[9px] font-semibold uppercase tracking-[0.28em] text-[#684354]">
            Belleza · Estilo · Detalles
          </span>
        </a>

        {/* Botones */}
        <div className="flex items-center justify-end gap-2">

          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileMenu ? "Cerrar navegación" : "Abrir navegación"}
            aria-expanded={mobileMenu}
            aria-controls="store-mobile-nav"
            onClick={() => setMobileMenu(!mobileMenu)}
            className="text-[#493540] hover:bg-white/40 hover:text-[#493540] md:hidden"
          >
            {mobileMenu ? <X /> : <Menu />}
          </Button>

          <Button
            onClick={onOpenCart}
            aria-label={`Abrir carrito, ${cartCount} piezas`}
            className="h-10 rounded-full bg-[#B83272] px-4 text-white shadow-sm hover:bg-[#98265C]"
          >
            <ShoppingBag className="h-4 w-4" />

            <span className="hidden sm:inline">
              Mi carrito
            </span>

            <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-[#B83272]">
              {cartCount}
            </span>
          </Button>
        </div>

        {/* Buscador móvil */}
        <div className="relative col-span-2 lg:hidden">
          <Search
            aria-hidden="true"
            className="absolute left-3.5 top-3 h-4 w-4 text-[#B83272]"
          />

          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-10 rounded-full border-white bg-white pl-10 pr-10 text-sm text-[#3D2A35] placeholder:text-[#8B6B7A]"
          />

          {search && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Borrar búsqueda"
              onClick={() => onSearchChange("")}
              className="absolute right-0 top-0 rounded-full text-[#B83272]"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {/* Navegación escritorio */}
      <nav
        aria-label="Navegación de tienda"
        className="hidden items-center justify-center gap-7 border-t border-white/40 bg-[#EFAACB] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.11em] text-[#493540] md:flex"
      >
        {links.map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="whitespace-nowrap text-[#493540] transition-colors hover:text-[#98265C]"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Categorías */}
      {categories.length > 1 && (
        <nav
          aria-label="Categorías"
          className="hidden items-center justify-center gap-2 overflow-x-auto border-t border-[#EBC9D9] bg-[#F4C5DA] px-5 py-2.5 xl:flex"
        >
          {categories.slice(0, 11).map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={activeCategory === cat}
              onClick={() => onSelectCategory?.(cat)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-[#B83272] text-white"
                  : "text-[#493540] hover:bg-white/60"
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>
      )}

      {/* Menú móvil */}
      {mobileMenu && (
        <nav
          id="store-mobile-nav"
          aria-label="Navegación móvil"
          className="max-h-[65dvh] overflow-y-auto border-t border-[#F0DCE5] bg-white px-4 py-2 md:hidden"
        >
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileMenu(false)}
              className="flex items-center justify-between border-b border-[#F5EAF0] py-3 text-sm text-[#3D2A35]"
            >
              {label}
              <ArrowRight className="h-4 w-4 text-[#B83272]" />
            </a>
          ))}

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2 py-3">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={activeCategory === cat ? "default" : "outline"}
                  className="rounded-full border-[#E8CAD8] text-xs"
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
