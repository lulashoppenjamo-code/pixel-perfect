
import { useState } from "react";
import { Plus, Check, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { StoreProduct } from "@/lib/store/demoCatalog";

type StoreProductCardProps = {
  product: StoreProduct & { stock?: number };
  onAdd: (product: StoreProduct) => void;
};

export function StoreProductCard({
  product,
  onAdd,
}: StoreProductCardProps) {
  const stock = product.stock ?? (product.available ? 1 : 0);
  const [imgError, setImgError] = useState(false);
  const [added, setAdded] = useState(false);

  const hasImage = Boolean(product.image_url) && !imgError;
  const available = product.available && stock > 0;

  const handleAdd = () => {
    if (!available) return;

    onAdd(product);
    setAdded(true);

    window.setTimeout(() => {
      setAdded(false);
    }, 1200);
  };

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_4px_20px_rgba(139,58,92,0.08)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(139,58,92,0.16)]">
      {/* Fotografía */}
      <div className="relative aspect-square overflow-hidden bg-white">
        {hasImage ? (
          <img
            src={product.image_url!}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-105 sm:p-5"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-rose-50 to-slate-50">
            {product.emoji ? (
              <span className="text-5xl sm:text-6xl" aria-hidden="true">
                {product.emoji}
              </span>
            ) : (
              <ImageOff className="h-9 w-9 text-rose-200" />
            )}
            <span className="text-[10px] font-medium text-slate-400">
              Lula Shop
            </span>
          </div>
        )}

        {!available && (
          <span className="absolute left-2 top-2 rounded-full bg-slate-800/90 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-white sm:left-3 sm:top-3 sm:text-[10px]">
            Agotado
          </span>
        )}

        {available && stock <= 5 && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2.5 py-1 text-[9px] font-bold text-white sm:left-3 sm:top-3 sm:text-[10px]">
            Últimas {stock}
          </span>
        )}
      </div>

      {/* Información del producto */}
      <div className="flex flex-1 flex-col p-2.5 sm:p-4">
        <p
          className="mb-1 line-clamp-1 text-[9px] font-bold uppercase tracking-[0.16em] sm:text-[10px]"
          style={{ color: "var(--store-primary, #e11d48)" }}
        >
          {product.category || "Producto"}
        </p>

        <h3 className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug text-slate-800 sm:text-sm">
          {product.name}
        </h3>

        {product.description && (
          <p className="mt-1 line-clamp-1 text-[10px] text-slate-400 sm:text-xs">
            {product.description}
          </p>
        )}

        <div className="mt-auto pt-3">
          <p className="mb-2 text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
            {money(product.price)}
          </p>

          <Button
            type="button"
            disabled={!available}
            onClick={handleAdd}
            className="h-9 w-full rounded-full text-[11px] font-semibold uppercase tracking-wider text-white shadow-none transition hover:opacity-90 sm:h-10 sm:text-xs"
            style={{
              backgroundColor: available ? "var(--store-primary, #e11d48)" : "#f1f1f1",
              color: available ? "#ffffff" : "#9ca3af",
            }}
          >
            {added ? (
              <>
                <Check className="mr-1 h-4 w-4" />
                Agregado
              </>
            ) : available ? (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Agregar
              </>
            ) : (
              "No disponible"
            )}
          </Button>
        </div>
      </div>
    </article>
  );
}
