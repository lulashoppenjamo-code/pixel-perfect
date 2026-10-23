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

/**
 * Construye el reporte de errores de análisis.
 * Solo filas con status === "error".
 * Columnas originales separadas (nunca JSON.stringify en una sola celda).
 * Incluye fila, producto, error concreto y solución sugerida.
 */
export function buildImportErrorReportRows(rows: ProductImportRow[]): Record<string, unknown>[] {
  const errorRows = rows.filter((r) => r.status === "error");

  return errorRows.map((r) => {
    const base: Record<string, unknown> = {
      fila: r.row,
      producto: r.nombre || r.sku || r.codigo_barras || "(sin nombre)",
      error: r.error ?? "Error",
      solucion_sugerida: suggestSolution(r.error),
    };

    // Expandir cada columna original como columna separada (preserva datos exactos del Excel de origen)
    for (const [header, value] of Object.entries(r.original ?? {})) {
      // Prefijo para evitar colisión con las columnas de control
      const safeKey = `orig_${String(header).trim() || "columna"}`;
      base[safeKey] = value;
    }

    return base;
  });
}

function suggestSolution(error: string | undefined): string {
  if (!error) return "Revisar formato de la fila";

  if (error.includes("Nombre vacío")) return "Completar la columna de nombre (ITEM_NAME / nombre)";
  if (error.includes("Precio") || error.includes("precio_venta")) return "Usar número >= 0 en PRICE / precio_venta (acepta 1.234,56 o 1234.56)";
  if (error.includes("Costo") || error.includes("costo")) return "Usar número >= 0 en COST_PRICE / costo";
  if (error.includes("stock") || error.includes("Stock")) return "Usar número >= 0 en STOCK";
  if (error.includes("minimo") || error.includes("Máximo")) return "Revisar minimo/maximo: números >= 0 y máximo >= mínimo";
  if (error.includes("variantes") || error.includes("VARIANT")) return "Este flujo no soporta productos con variantes. Eliminar VARIANT_NAME o importar por otro medio";
  if (error.includes("SKU/código ambiguo") || error.includes("SKU repetido") || error.includes("Código repetido") || error.includes("Producto repetido")) {
    return "Resolver duplicados o ambigüedades de SKU/BARCODE dentro del archivo o contra el catálogo existente";
  }
  if (error.includes("URL de imagen")) return "Usar URL http/https válida sin credenciales, o dejar vacía";
  if (error.includes("Encabezados duplicados")) return "Eliminar columnas de encabezado duplicadas en el Excel";
  return "Revisar formato de la fila y valores numéricos / identificadores";
}

export async function downloadImportErrors(rows: ProductImportRow[]) {
  const reportRows = buildImportErrorReportRows(rows);
  await downloadWorkbook("errores_importacion.xlsx", [{ name: "Errores", rows: reportRows }]);
}