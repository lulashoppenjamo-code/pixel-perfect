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
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary">
      <div className="relative flex aspect-square items-center justify-center bg-secondary p-5 text-5xl sm:p-7">
        <ProductImage
          src={product.image_url}
          emoji={product.emoji}
          name={product.name}
          className="h-full w-full object-contain motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
        />

        {!available && (
          <span className="absolute left-3 top-3 rounded-sm bg-foreground px-2 py-1 text-[10px] font-semibold text-background">
            Agotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="mb-1 truncate text-[10px] font-semibold uppercase text-primary">
          {product.category}
        </p>

        <h3 className="line-clamp-2 min-h-10 break-words text-sm font-medium leading-5">
          {product.name}
        </h3>

        <p className="mt-3 text-lg font-bold text-foreground">
          {money(product.price)}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {available
            ? `${stock} disponibles`
            : "Sin existencias"}
        </p>

        <div className="mt-auto pt-4">
          <div className="mb-2 flex h-9 items-center justify-between rounded border border-border">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded"
              aria-label={`Restar cantidad de ${product.name}`}
              disabled={!available || quantity <= 1}
              onClick={() =>
                setQuantity((value) => Math.max(1, value - 1))
              }
            >
              <Minus />
            </Button>

            <span
              className="min-w-6 text-center text-sm tabular-nums"
              aria-label="Cantidad"
            >
              {quantity}
            </span>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded"
              aria-label={`Aumentar cantidad de ${product.name}`}
              disabled={!available || quantity >= stock}
              onClick={() =>
                setQuantity((value) => Math.min(stock, value + 1))
              }
            >
              <Plus />
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
            className="h-10 w-full rounded-full px-2 text-xs"
          >
            <ShoppingBag className="hidden sm:block" />
            {available ? "Agregar al carrito" : "No disponible"}
          </Button>
        </div>
      </div>
    </article>
  );
}