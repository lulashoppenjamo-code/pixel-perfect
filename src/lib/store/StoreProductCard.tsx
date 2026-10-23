import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { StoreProduct } from "@/lib/store/demoCatalog";

type StoreProductCardProps = {
  product: StoreProduct;
  onAdd: (product: StoreProduct) => void;
};

export function StoreProductCard({
  product,
  onAdd,
}: StoreProductCardProps) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-rose-100 bg-white shadow-sm transition hover:shadow-md">
      <div className="relative flex aspect-square items-center justify-center bg-gradient-to-b from-rose-50 to-pink-50/80">
        <span className="text-5xl sm:text-6xl" aria-hidden>
          {product.emoji}
        </span>
        {!product.available && (
          <span className="absolute left-2 top-2 rounded-full bg-gray-800/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Agotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5 sm:p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-rose-400">
          {product.category}
        </p>
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-rose-950 sm:text-[15px]">
          {product.name}
        </h3>
        <p className="mt-auto text-lg font-bold text-rose-700">
          {money(product.price)}
        </p>

        <Button
          type="button"
          disabled={!product.available}
          onClick={() => onAdd(product)}
          className="mt-1 h-10 w-full rounded-full bg-rose-600 font-semibold text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-200 disabled:text-rose-400"
        >
          {product.available ? (
            <>
              <Plus className="h-4 w-4" />
              Agregar
            </>
          ) : (
            "No disponible"
          )}
        </Button>
      </div>
    </article>
  );
}