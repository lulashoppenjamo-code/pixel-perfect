/**
 * Utilidades de importación / exportación Excel-CSV — LULA OS
 * Requiere: npm i xlsx  (o bun add xlsx)
 */
import type { WorkBook } from "xlsx";

export const PRODUCT_TEMPLATE_HEADERS = [
  "nombre",
  "sku",
  "codigo_barras",
  "categoria",
  "precio_venta",
  "costo",
  "stock",
  "minimo",
  "maximo",
  "unidad",
  "descripcion",
  "image_url",
] as const;

export { type ProductImportRow, type ImportAction } from "@/lib/productImport";
import { analyzeProductGrid, type ExistingImportProduct, type ProductImportRow } from "@/lib/productImport";

export async function loadXlsx(): Promise<typeof import("xlsx")> {
  return import("xlsx");
}

export async function analyzeProductFile(file: File, existing: ExistingImportProduct[]) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", raw: true, cellText: true });
  const firstName = wb.SheetNames[0];
  const sheet = firstName ? wb.Sheets[firstName] : undefined;
  if (!sheet) throw new Error("Archivo sin hojas");
  // raw:false preserves textual IDs and Excel's displayed zero-padding formats.
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true });
  const analysis = analyzeProductGrid(grid, existing);
  if (!analysis.rows.length) throw new Error("No se encontraron filas de productos");
  return analysis;
}

export async function parseProductFile(file: File, existing: ExistingImportProduct[]): Promise<ProductImportRow[]> {
  return (await analyzeProductFile(file, existing)).rows;
}

export async function downloadTemplate() {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([
    [...PRODUCT_TEMPLATE_HEADERS],
    [
      "Producto ejemplo",
      "SKU-001",
      "7501234567890",
      "General",
      100,
      60,
      10,
      2,
      50,
      "pza",
      "Descripción opcional",
      "https://example.com/producto.jpg",
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Productos");
  XLSX.writeFile(wb, "plantilla_productos_lula.xlsx");
}

export async function downloadWorkbook(
  filename: string,
  sheets: { name: string; rows: Record<string, unknown>[] }[],
) {
  const XLSX = await loadXlsx();
  const wb: WorkBook = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ info: "sin datos" }]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export async function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: "sin datos" }]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadImportFailures(
  failures: { row: number; nombre: string; message: string }[],
) {
  const rows = failures.map((f) => ({
    fila: f.row,
    producto: f.nombre,
    error: f.message,
  }));
  await downloadWorkbook("fallas_importacion.xlsx", [{ name: "Fallas", rows }]);
}

export async function downloadImportErrors(
  rows: ProductImportRow[],
) {
  const errors = rows
    .filter((r) => r.status === "error")
    .map((r) => ({
      fila: r.row,
      producto: r.nombre,
      error: r.error ?? "Error",
      valor_recibido: JSON.stringify(r.original),
      solucion_sugerida:
        r.error === "Nombre vacío"
          ? "Completar columna nombre"
          : r.error?.includes("Precio")
            ? "Usar número >= 0 en precio_venta"
            : r.error?.includes("Costo")
              ? "Usar número >= 0 en costo"
              : "Revisar formato de la fila",
    }));
  await downloadWorkbook("errores_importacion.xlsx", [{ name: "Errores", rows: errors }]);
}
