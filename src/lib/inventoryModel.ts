
import type { Database } from "@/integrations/supabase/types";
import type { SharedInventoryRow } from "@/lib/sharedInventory";

type Product = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  | "id"
  | "name"
  | "sku"
  | "barcode"
  | "price"
  | "cost"
  | "image_url"
  | "emoji"
  | "is_active"
>;

type Variant = Pick<
  Database["public"]["Tables"]["product_variants"]["Row"],
  | "id"
  | "product_id"
  | "name"
  | "sku"
  | "barcode"
  | "price_override"
  | "cost_override"
  | "image_url"
>;

type Stock = Database["public"]["Tables"]["shared_inventory"]["Row"];

export function requireInventoryBranch(
  branchId: string | null,
  branches: readonly { id: string; is_active: boolean }[],
  loading: boolean,
): string {
  if (
    loading ||
    !branchId ||
    !branches.some((b) => b.id === branchId && b.is_active)
  ) {
    throw new Error(
      "Selecciona una sucursal activa disponible antes de continuar.",
    );
  }

  return branchId;
}

/** Identidad exacta de producto y variante. */
export function buildInventoryRows(
  products: readonly Product[],
  variants: readonly Variant[],
  stocks: readonly Stock[],
): SharedInventoryRow[] {
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const byVariant = new Map(variants.map((v) => [v.id, v]));
  const rows = new Map<string, SharedInventoryRow>();

  const add = (
    product: Product,
    variant: Variant | undefined,
    stock?: Stock,
  ) => {
    const variantId = variant?.id ?? null;
    const id = variantId
      ? `${product.id}:${variantId}`
      : product.id;

    const physical = Number(stock?.stock ?? 0);
    const reserved = Number(stock?.reserved_stock ?? 0);
    const available = Math.max(physical - reserved, 0);
    const minimum = Number(stock?.min_stock ?? 0);

    rows.set(id, {
      id,
      product_id: product.id,
      variant_id: variantId,
      product_name: variant
        ? `${product.name} — ${variant.name}`
        : product.name,
      sku: variant?.sku ?? product.sku,
      barcode: variant?.barcode ?? product.barcode,
      price: Number(
        variant?.price_override ?? product.price,
      ),
      cost: Number(
        variant?.cost_override ?? product.cost,
      ),
      image_url: variant?.image_url ?? product.image_url,
      emoji: product.emoji,
      is_active: product.is_active,
      stock: physical,
      reserved_stock: reserved,
      available_stock: available,
      min_stock: minimum,
      max_stock: stock?.max_stock ?? null,
      stock_status:
        available <= 0
          ? "out_of_stock"
          : available <= minimum
            ? "low_stock"
            : "ok",
    });
  };

  for (const stock of stocks) {
    const product = byProduct.get(stock.product_id);

    if (!product) {
      throw new Error(
        `Existencia sin producto accesible: ${stock.product_id}`,
      );
    }

    const variant = stock.variant_id
      ? byVariant.get(stock.variant_id)
      : undefined;

    if (
      stock.variant_id &&
      (!variant || variant.product_id !== product.id)
    ) {
      throw new Error(
        `Existencia con variante incompatible: ${stock.variant_id}`,
      );
    }

    add(product, variant, stock);
  }

  for (const variant of variants) {
    const product = byProduct.get(variant.product_id);

    if (
      product &&
      !rows.has(`${product.id}:${variant.id}`)
    ) {
      add(product, variant);
    }
  }

  const productsWithVariants = new Set(
    variants.map((v) => v.product_id),
  );

  for (const product of products) {
    if (
      !productsWithVariants.has(product.id) &&
      !rows.has(product.id)
    ) {
      add(product, undefined);
    }
  }

  return [...rows.values()].sort((a, b) =>
    a.product_name.localeCompare(b.product_name),
  );
}
