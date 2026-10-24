
 // ============================================================
 // src/lib/sharedInventory.ts
 // LULA OS — API DEL INVENTARIO CENTRAL
 // ============================================================

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

  stock_status: "ok" | "low_stock" | "out_of_stock" | string;
};

export type SharedProductStock = {
  product_id: string;
  variant_id: string | null;
  stock: number;
  reserved_stock: number;
  available_stock: number;
};

/**
 * Obtiene todo el inventario compartido por páginas.
 *
 * Evita depender de una única respuesta que puede estar
 * limitada por el máximo de filas devuelto por la API.
 */
export async function getSharedInventory(): Promise<
  SharedInventoryRow[]
> {
  const pageSize = 500;
  const allRows: SharedInventoryRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await (supabase as any)
      .rpc("get_shared_inventory")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as SharedInventoryRow[];

    allRows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allRows;
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

  if (!data || data.length === 0) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return null;
  }

  return {
    product_id: row.product_id,
    variant_id: row.variant_id ?? null,
    stock: Number(row.stock ?? 0),
    reserved_stock: Number(row.reserved_stock ?? 0),
    available_stock: Number(row.available_stock ?? 0),
  };
}

export async function getAvailableSharedStock(
  productId: string,
  variantId: string | null = null,
): Promise<number> {
  const result = await getSharedProductStock(
    productId,
    variantId,
  );

  return Number(result?.available_stock ?? 0);
}

export async function setSharedInventoryLimits(
  productId: string,
  variantId: string | null,
  minStock: number,
  maxStock: number | null,
): Promise<void> {
  const { error } = await (supabase as any).rpc(
    "set_shared_inventory_limits",
    {
      _product_id: productId,
      _variant_id: variantId,
      _min_stock: minStock,
      _max_stock: maxStock,
    },
  );

  if (error) {
    throw error;
  }
}

export async function getSharedStockMap(): Promise<
  Map<string, number>
> {
  const rows = await getSharedInventory();

  const result = new Map<string, number>();

  for (const row of rows) {
    const key = row.variant_id
      ? `${row.product_id}:${row.variant_id}`
      : row.product_id;

    result.set(key, Number(row.available_stock ?? 0));
  }

  return result;
}
