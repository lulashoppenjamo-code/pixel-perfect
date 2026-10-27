import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { StoreProduct } from "@/lib/store/demoCatalog";

type StoreProductCardProps = {
  product: StoreProduct & { stock?: number };
  onAdd: (product: StoreProduct) => void;
};

export function StoreProductCard({ product, onAdd }: StoreProductCardProps) {
  const stock = product.stock ?? (product.available ? 1 : 0);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative flex aspect-square items-center justify-center bg-gradient-to-b from-rose-50 to-pink-50/70">
        <span className="text-5xl transition group-hover:scale-105 sm:text-6xl" aria-hidden>
          {product.emoji}
        </span>
        {!product.available && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-gray-900/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            Agotado
          </span>
        )}
        {product.available && stock > 0 && stock <= 5 && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            Últimas {stock}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
          {product.category || "Producto"}
        </p>
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-rose-950 sm:text-[15px]">
          {product.name}
        </h3>
        {product.description && (
          <p className="line-clamp-1 text-[11px] text-rose-400">
            {product.description}
          </p>
        )}
        <p className="mt-auto pt-1 text-lg font-bold text-rose-700">
          {money(product.price)}
        </p>

        <Button
          type="button"
          disabled={!product.available}
          onClick={() => onAdd(product)}
          className="mt-1 h-10 w-full rounded-full bg-rose-600 font-semibold text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-100 disabled:text-rose-300"
        >
          {product.available ? (
            <>
              <Plus className="h-4 w-4" />
              Añadir al carrito
            </>
          ) : (
            "No disponible"
          )}
        </Button>
      </div>
    </article>
  );
}