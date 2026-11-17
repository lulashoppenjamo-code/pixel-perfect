import { getSharedInventory, type SharedInventoryRow } from "@/lib/sharedInventory";
import { supabase } from "@/integrations/supabase/client";
import { buildInventoryRows } from "@/lib/inventoryModel";

/**
 * Inventario operativo para pantallas Inventario / Productos.
 * Prioridad: mismo origen que Caja (RPC get_shared_inventory, SECURITY DEFINER).
 * Fallback: lectura directa de tablas + buildInventoryRows.
 */
export async function getOperationalInventory(): Promise<SharedInventoryRow[]> {
  try {
    const rows = await getSharedInventory();
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
  } catch {
    // Continuar con fallback de tablas
  }

  const pageSize = 500;

  async function readPages<T>(
    read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await read(offset);
      if (error) throw error;
      const page = data ?? [];
      result.push(...page);
      if (page.length < pageSize) return result;
    }
  }

  const [products, variants, stocks] = await Promise.all([
    readPages((offset) =>
      supabase
        .from("products")
        .select("id,name,sku,barcode,price,cost,image_url,emoji,is_active")
        .order("id")
        .range(offset, offset + pageSize - 1),
    ),
    readPages((offset) =>
      supabase
        .from("product_variants")
        .select(
          "id,product_id,name,sku,barcode,price_override,cost_override,image_url",
        )
        .order("id")
        .range(offset, offset + pageSize - 1),
    ),
    readPages((offset) =>
      supabase
        .from("shared_inventory")
        .select("*")
        .order("id")
        .range(offset, offset + pageSize - 1),
    ),
  ]);

  return buildInventoryRows(products, variants, stocks);
}
