
import { useEffect, useState } from "react";
import { Plus, Minus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/ProductImage";
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
    Math.floor(product.stock ?? (product.available ? 1 : 0))
  );

  const [quantity, setQuantity] = useState(1);
  const available = product.available && stock > 0;

  useEffect(() => {
    setQuantity((value) => Math.max(1, Math.min(stock, value)));
  }, [stock, product.id]);

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-[3px] border border-[#f0e4e9] bg-white transition-all duration-300 hover:-translate-y-0.5 hover:border-[#dfb8ca] hover:shadow-[0_10px_28px_rgba(119,48,79,0.09)]">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-[#fff9fb] p-3 sm:p-5">
        <ProductImage
          src={product.image_url}
          emoji={product.emoji}
          name={product.name}
          className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.045]"
        />

        {!available && (
          <span className="absolute left-2 top-2 bg-[#5a4650] px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white">
            Agotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <p className="mb-1.5 truncate text-[9px] font-semibold uppercase tracking-[0.13em] text-[#ad6684]">
          {product.category}
        </p>

        <h3 className="line-clamp-2 min-h-10 break-words text-[12px] font-medium leading-[1.45] text-[#44313b] sm:text-[13px]">
          {product.name}
        </h3>

        <p className="mt-2.5 text-base font-bold tracking-tight text-[#9f3e67] sm:text-lg">
          {money(product.price)}
        </p>

        <p className="mt-1 text-[10px] text-[#927f89]">
          {available ? `${stock} disponibles` : "Sin existencias"}
        </p>

        <div className="mt-auto pt-3">
          <div className="mb-2 flex h-8 items-center justify-between border border-[#ead9e1] bg-[#fffafd]">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-8 rounded-none text-[#a34d70] hover:bg-[#fbedf3]"
              aria-label={`Restar cantidad de ${product.name}`}
              disabled={!available || quantity <= 1}
              onClick={() =>
                setQuantity((value) => Math.max(1, value - 1))
              }
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>

            <span
              className="min-w-6 text-center text-xs tabular-nums text-[#493641]"
              aria-label="Cantidad"
            >
              {quantity}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-8 rounded-none text-[#a34d70] hover:bg-[#fbedf3]"
              aria-label={`Aumentar cantidad de ${product.name}`}
              disabled={!available || quantity >= stock}
              onClick={() =>
                setQuantity((value) => Math.min(stock, value + 1))
              }
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            disabled={!available || quantity > stock}
            onClick={() => {
              if (available && quantity <= stock) {
                onAdd(product, quantity);
                setQuantity(1);
              }
            }}
            className="h-9 w-full rounded-[2px] bg-[#a83f6c] px-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-[#873254] sm:text-[11px]"
          >
            <ShoppingBag className="mr-1.5 h-3.5 w-3.5" />
            {available ? "Agregar al carrito" : "No disponible"}
          </Button>
        </div>
      </div>
    </article>
  );
}
