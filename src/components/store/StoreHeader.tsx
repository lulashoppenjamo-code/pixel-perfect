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
    <header className="sticky top-0 z-40 border-b border-border bg-background text-foreground">
      <div className="bg-primary px-4 py-2 text-center text-xs text-primary-foreground">
        Lula Shop · Tienda en línea
      </div>

      <div className="mx-auto grid max-w-[1440px] grid-cols-[1fr_auto] items-center gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-10 lg:py-6">
        <div className="relative hidden max-w-sm lg:block">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-primary"
          />

          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Busca tus favoritos"
            className="h-10 rounded-full border-border bg-secondary pl-10 pr-10"
          />

          {search && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSearchChange("")}
              aria-label="Borrar búsqueda"
              className="absolute right-0 top-0 rounded-full"
            >
              <X />
            </Button>
          )}
        </div>

        <a
          href="#inicio"
          className="w-fit text-primary lg:text-center"
          aria-label="Lula Shop, inicio"
        >
          <span className="block font-serif text-3xl font-bold italic leading-none sm:text-4xl">
            Lula Shop
          </span>

          <span className="mt-1.5 block text-[10px] uppercase">
            Tienda en línea
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
            className="text-primary md:hidden"
          >
            {mobileMenu ? <X /> : <Menu />}
          </Button>

          <Button
            variant="outline"
            onClick={onOpenCart}
            aria-label={`Abrir carrito, ${cartCount} piezas`}
            className="rounded-full border-primary text-primary"
          >
            <ShoppingBag />
            <span className="hidden sm:inline">Carrito</span>
            <span className="min-w-4 text-center">{cartCount}</span>
          </Button>
        </div>

        <div className="relative col-span-2 lg:hidden">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-primary"
          />

          <Input
            aria-label="Buscar productos"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="¿Qué estás buscando?"
            className="h-10 rounded-full bg-secondary pl-10 pr-10"
          />

          {search && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Borrar búsqueda"
              onClick={() => onSearchChange("")}
              className="absolute right-0 top-0 rounded-full"
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <nav
        aria-label="Navegación de tienda"
        className="hidden justify-center gap-8 border-t border-border px-4 py-3 text-xs font-semibold md:flex"
      >
        {links.map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="transition-colors hover:text-primary"
          >
            {label}
          </a>
        ))}
      </nav>

      {mobileMenu && (
        <nav
          id="store-mobile-nav"
          aria-label="Navegación móvil"
          className="max-h-[50dvh] overflow-y-auto border-t border-border px-4 py-2 md:hidden"
        >
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileMenu(false)}
              className="flex items-center justify-between border-b border-border py-3 text-sm"
            >
              {label}
              <ArrowRight className="h-4 w-4 text-primary" />
            </a>
          ))}

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2 py-3">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={activeCategory === cat ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => {
                    onSelectCategory?.(cat);
                    setMobileMenu(false);
                    document.getElementById("catalogo")?.scrollIntoView();
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