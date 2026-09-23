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
  max_stock: number;
  stock_status: string;
};

export type SharedProductStock = {
  product_id: string;
  variant_id: string | null;
  stock: number;
  reserved_stock: number;
  available_stock: number;
};

export async function getSharedInventory(): Promise<SharedInventoryRow[]> {
  const { data, error } = await (supabase as any).rpc(
    "get_shared_inventory",
  );

  if (error) {
    throw error;
  }

  return (data ?? []) as SharedInventoryRow[];
}

export async function getSharedProductStock(
  productId: string,
  variantId: string | null = null,
): Promise<SharedProductStock | null> {
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

  if (!data) {
    return null;
  }

  return data as SharedProductStock;
}

export async function getAvailableSharedStock(
  productId: string,
  variantId: string | null = null,
): Promise<number> {
  const result = await getSharedProductStock(productId, variantId);

  return Number(result?.available_stock ?? 0);
}