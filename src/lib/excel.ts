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
  "proveedor",
] as const;

export type ProductImportRow = {
  row: number;
  nombre: string;
  sku: string;
  codigo_barras: string;
  categoria: string;
  precio_venta: number;
  costo: number;
  stock: number;
  minimo: number;
  maximo: number | null;
  unidad: string;
  descripcion: string;
  proveedor: string;
  error?: string;
  status: "valid" | "existing" | "error";
  existingId?: string;
};

export type ImportAction =
  | "update_all"
  | "update_stock"
  | "update_price_cost"
  | "update_data"
  | "skip_existing";

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

export async function loadXlsx(): Promise<typeof import("xlsx")> {
  return import("xlsx");
}

export async function parseProductFile(
  file: File,
  existing: { id: string; sku: string | null; barcode: string | null; name: string }[],
): Promise<ProductImportRow[]> {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) throw new Error("Archivo sin hojas");
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const byBarcode = new Map(
    existing.filter((e) => e.barcode).map((e) => [e.barcode!.toLowerCase(), e]),
  );
  const bySku = new Map(
    existing.filter((e) => e.sku).map((e) => [e.sku!.toLowerCase(), e]),
  );

  return raw.map((r, i) => {
    const get = (...keys: string[]) => {
      for (const [k, v] of Object.entries(r)) {
        const nk = normalizeHeader(k);
        if (keys.includes(nk)) return String(v ?? "").trim();
      }
      return "";
    };
    const num = (s: string) => {
      const n = Number(String(s).replace(",", "."));
      return Number.isFinite(n) ? n : NaN;
    };

    const nombre = get("nombre", "name", "producto");
    const sku = get("sku");
    const codigo_barras = get("codigo_barras", "barcode", "codigo", "barras");
    const categoria = get("categoria", "category");
    const precio_venta = num(get("precio_venta", "precio", "price"));
    const costo = num(get("costo", "cost", "coste"));
    const stock = num(get("stock", "existencia", "qty") || "0");
    const minimo = num(get("minimo", "min_stock", "min") || "0");
    const maxRaw = get("maximo", "max_stock", "max");
    const maximo = maxRaw === "" ? null : num(maxRaw);
    const unidad = get("unidad", "unit") || "pza";
    const descripcion = get("descripcion", "description");
    const proveedor = get("proveedor", "supplier");

    let error: string | undefined;
    if (!nombre) error = "Nombre vacío";
    else if (Number.isNaN(precio_venta) || precio_venta < 0) error = "Precio inválido";
    else if (Number.isNaN(costo) || costo < 0) error = "Costo inválido";
    else if (Number.isNaN(stock) || stock < 0) error = "Stock inválido";
    else if (Number.isNaN(minimo) || minimo < 0) error = "Mínimo inválido";
    else if (maximo !== null && (Number.isNaN(maximo) || maximo < 0)) error = "Máximo inválido";

    const match =
      (codigo_barras && byBarcode.get(codigo_barras.toLowerCase())) ||
      (sku && bySku.get(sku.toLowerCase())) ||
      undefined;

    let status: ProductImportRow["status"] = error ? "error" : match ? "existing" : "valid";
    if (error) status = "error";

    return {
      row: i + 2,
      nombre,
      sku,
      codigo_barras,
      categoria,
      precio_venta: Number.isNaN(precio_venta) ? 0 : precio_venta,
      costo: Number.isNaN(costo) ? 0 : costo,
      stock: Number.isNaN(stock) ? 0 : stock,
      minimo: Number.isNaN(minimo) ? 0 : minimo,
      maximo: maximo !== null && !Number.isNaN(maximo) ? maximo : null,
      unidad,
      descripcion,
      proveedor,
      error,
      status,
      existingId: match?.id,
    };
  });
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
      "Proveedor SA",
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

export async function downloadImportErrors(
  rows: ProductImportRow[],
) {
  const errors = rows
    .filter((r) => r.status === "error")
    .map((r) => ({
      fila: r.row,
      producto: r.nombre,
      error: r.error ?? "Error",
      valor_recibido: JSON.stringify({
        sku: r.sku,
        barcode: r.codigo_barras,
        precio: r.precio_venta,
        costo: r.costo,
        stock: r.stock,
      }),
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
