import { supabase } from "@/integrations/supabase/client";

export type SharedInventoryRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  image_url: string | null;
  emoji: string | null;
  is_active: boolean;
  stock: number;
  reserved_stock: number;
  available_stock: number;
  min_stock: number;
  max_stock: number | null;
  stock_status: "ok" | "low_stock" | "out_of_stock";
};

export type SharedProductStock = {
  stock: number;
  reserved_stock: number;
  available_stock: number;
  min_stock: number;
  max_stock: number | null;
  stock_status: "ok" | "low_stock" | "out_of_stock";
};

/**
 * INVENTARIO CENTRAL LULA OS
 *
 * Esta función debe utilizarse para consultar existencia.
 *
 * NO consulta:
 *   public.inventory
 *
 * Consulta:
 *   public.shared_inventory
 */
export async function getSharedInventory(): Promise<SharedInventoryRow[]> {
  const { data, error } = await (supabase as any).rpc(
    "get_shared_inventory",
  );

  if (error) {
    throw error;
  }

  return ((data ?? []) as SharedInventoryRow[]).map((row) => ({
    ...row,
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    stock: Number(row.stock ?? 0),
    reserved_stock: Number(row.reserved_stock ?? 0),
    available_stock: Number(row.available_stock ?? 0),
    min_stock: Number(row.min_stock ?? 0),
    max_stock:
      row.max_stock === null || row.max_stock === undefined
        ? null
        : Number(row.max_stock),
  }));
}

/**
 * Obtiene existencia de un producto o variante.
 */
export async function getSharedProductStock(
  productId: string,
  variantId: string | null = null,
): Promise<SharedProductStock> {
  const { data, error } = await (supabase as any).rpc(
    "get_shared_product_stock",
    {
      _product_id: productId,
      _variant_id: variantId,
    },
  );

  if (error) {
    throw error;
  }

  const row = data?.[0];

  if (!row) {
    return {
      stock: 0,
      reserved_stock: 0,
      available_stock: 0,
      min_stock: 0,
      max_stock: null,
      stock_status: "out_of_stock",
    };
  }

  return {
    stock: Number(row.stock ?? 0),
    reserved_stock: Number(row.reserved_stock ?? 0),
    available_stock: Number(row.available_stock ?? 0),
    min_stock: Number(row.min_stock ?? 0),
    max_stock:
      row.max_stock === null || row.max_stock === undefined
        ? null
        : Number(row.max_stock),
    stock_status: row.stock_status ?? "out_of_stock",
  };
}

/**
 * Devuelve únicamente la existencia disponible.
 */
export async function getAvailableSharedStock(
  productId: string,
  variantId: string | null = null,
): Promise<number> {
  const result = await getSharedProductStock(productId, variantId);

  return result.available_stock;
}