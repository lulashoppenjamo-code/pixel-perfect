
import { useState } from "react";
import { Plus, Minus, Check, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { StoreProduct } from "@/lib/store/demoCatalog";

type StoreProductCardProps = {
  product: StoreProduct & { stock?: number };
  onAdd: (product: StoreProduct, quantity?: number) => void;
};

export function StoreProductCard({
  product,
  onAdd,
}: StoreProductCardProps) {
  const stock = Math.max(
    0,
    Math.floor(product.stock ?? (product.available ? 1 : 0)),
  );

  const [quantity, setQuantity] = useState(1);
  const [imgError, setImgError] = useState(false);
  const [added, setAdded] = useState(false);

  const available = product.available && stock > 0;
  const hasImage = Boolean(product.image_url) && !imgError;

  const handleAdd = () => {
    if (!available || quantity > stock) return;

    onAdd(product, quantity);
    setAdded(true);
    setQuantity(1);
    window.setTimeout(() => setAdded(false), 1200);
  };

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden border border-pink-100 bg-white transition hover:border-pink-300 hover:shadow-lg">
      <div className="relative aspect-square overflow-hidden bg-[#FDE8F1]">
        {hasImage ? (
          <img
            src={product.image_url!}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain transition duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            {product.emoji ? (
              <span className="text-5xl">{product.emoji}</span>
            ) : (
              <ImageOff className="h-9 w-9 text-pink-300" />
            )}
            <span className="text-xs text-pink-500">Lula Shop</span>
          </div>
        )}

        {!available && (
          <span className="absolute left-2 top-2 bg-slate-800 px-2 py-1 text-[9px] font-bold uppercase text-white">
            Agotado
          </span>
        )}

        {available && stock <= 5 && (
          <span className="absolute left-2 top-2 bg-pink-600 px-2 py-1 text-[9px] font-bold text-white">
            Últimas {stock}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col border-t border-pink-50 p-3 sm:p-4">
        <p className="mb-1 line-clamp-1 text-[10px] font-bold uppercase tracking-wider text-pink-500">
          {product.category || "Belleza"}
        </p>

        <h3 className="line-clamp-2 min-h-10 text-xs font-medium leading-snug text-slate-800 sm:text-sm">
          {product.name}
        </h3>

        <p className="mt-3 text-base font-extrabold text-pink-800 sm:text-lg">
          {money(product.price)}
        </p>

        {available && (
          <div className="mt-3 flex h-9 items-center justify-between border border-pink-200">
            <button
              type="button"
              aria-label="Restar cantidad"
              disabled={quantity <= 1}
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              className="flex h-full w-9 items-center justify-center text-pink-700 disabled:opacity-30"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>

            <span className="text-sm font-bold text-slate-800">
              {quantity}
            </span>

            <button
              type="button"
              aria-label="Aumentar cantidad"
              disabled={quantity >= stock}
              onClick={() => setQuantity((value) => Math.min(stock, value + 1))}
              className="flex h-full w-9 items-center justify-center text-pink-700 disabled:opacity-30"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <Button
          type="button"
          disabled={!available || quantity > stock}
          onClick={handleAdd}
          className="mt-2 h-10 w-full rounded-full text-[10px] font-bold uppercase tracking-wider text-white sm:text-xs"
          style={{ backgroundColor: available ? "#E95C9B" : "#D1D5DB" }}
        >
          {added ? (
            <>
              <Check className="mr-1 h-4 w-4" />
              Agregado
            </>
          ) : available ? (
            "Comprar"
          ) : (
            "No disponible"
          )}
        </Button>
      </div>
    </article>
  );
}
