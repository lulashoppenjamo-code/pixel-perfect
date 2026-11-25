import { getSharedInventory, type SharedInventoryRow } from "@/lib/sharedInventory";
import { supabase } from "@/integrations/supabase/client";
import { buildInventoryRows } from "@/lib/inventoryModel";

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

/**
 * Inventario operativo para pantallas Inventario / Productos.
 *
 * 1) Lee shared_inventory (RPC).
 * 2) Siempre mezcla product_variants para que una variante recién creada
 *    aparezca aunque aún no tenga fila de stock (stock 0).
 * 3) Si el RPC falla, arma todo desde tablas.
 */
export async function getOperationalInventory(): Promise<SharedInventoryRow[]> {
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

  // Preferir filas del RPC cuando existen (mismos números que Caja),
  // y completar con variantes/productos que aún no tienen stock.
  try {
    const rpcRows = await getSharedInventory();
    if (Array.isArray(rpcRows) && rpcRows.length > 0) {
      const fromTables = buildInventoryRows(products, variants, stocks);
      const byKey = new Map<string, SharedInventoryRow>();

      for (const row of rpcRows) {
        const key = row.variant_id
          ? `${row.product_id}:${row.variant_id}`
          : row.product_id;
        byKey.set(key, row);
      }

      for (const row of fromTables) {
        const key = row.variant_id
          ? `${row.product_id}:${row.variant_id}`
          : row.product_id;
        if (!byKey.has(key)) {
          byKey.set(key, row);
        } else {
          // Enriquecer nombre/sku/precio de variante si el RPC solo trae datos del producto base
          const existing = byKey.get(key)!;
          if (row.variant_id) {
            byKey.set(key, {
              ...existing,
              product_name: row.product_name || existing.product_name,
              sku: row.sku ?? existing.sku,
              barcode: row.barcode ?? existing.barcode,
              price: row.price || existing.price,
              cost: row.cost || existing.cost,
              image_url: row.image_url ?? existing.image_url,
            });
          }
        }
      }

      return [...byKey.values()].sort((a, b) =>
        a.product_name.localeCompare(b.product_name),
      );
    }
  } catch {
    // fallback abajo
  }

  return buildInventoryRows(products, variants, stocks);
}
