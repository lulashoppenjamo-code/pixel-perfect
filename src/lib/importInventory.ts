/** Legacy API kept for compatibility; parsing delegates to the shared parser.
 * All writes must go through ImportExportPanel and its validated RPC contract.
 */
import * as XLSX from "xlsx";
import { analyzeProductGrid } from "@/lib/productImport";

export type ImportRow = {
  category: string; itemType: string; itemName: string; variantName: string;
  price: number; cost: number; stock: number; barcode: string; sku: string;
  error?: string | undefined;
};
export type ImportResult = { created: number; updated: number; skipped: number; errors: string[] };

export function parseInventoryWorkbook(file: ArrayBuffer): ImportRow[] {
  const wb = XLSX.read(file, { type: "array", raw: true, cellText: true });
  const first = wb.SheetNames[0];
  const sheet = first ? wb.Sheets[first] : undefined;
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
  return analyzeProductGrid(grid, []).rows.map((row) => ({ category: row.categoria, itemType: row.tipo, itemName: row.nombre, variantName: row.variante, price: row.precio_venta, cost: row.costo, stock: row.stock, barcode: row.codigo_barras, sku: row.sku, error: row.error }));
}

export async function importInventoryRows(
  _rows: ImportRow[],
  _onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  throw new Error("Importador antiguo deshabilitado para evitar escrituras en inventory legacy. Usa Importar / Exportar inventario, con vista previa y RPC validada.");
}
