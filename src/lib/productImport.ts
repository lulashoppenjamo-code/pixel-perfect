export type ImportAction = "update_all" | "update_stock" | "update_price_cost" | "update_data" | "skip_existing";

export const IMPORT_ALIASES = {
  nombre: ["nombre", "name", "producto", "product", "product_name", "item_name", "itemname"],
  sku: ["sku"],
  codigo_barras: ["codigo_barras", "codigo_de_barras", "barcode", "bar_code", "codigo", "barras"],
  categoria: ["categoria", "category"],
  precio_venta: ["precio_venta", "precio_de_venta", "precio", "price", "sale_price"],
  costo: ["costo", "cost", "coste", "cost_price", "costprice"],
  stock: ["stock", "existencia", "existencias", "qty", "quantity", "cantidad"],
  minimo: ["minimo", "min_stock", "stock_min", "stock_minimo", "minimum_stock", "min"],
  maximo: ["maximo", "max_stock", "stock_max", "stock_maximo", "maximum_stock", "max"],
  unidad: ["unidad", "unit"],
  descripcion: ["descripcion", "description"],
  proveedor: ["proveedor", "supplier"],
  image_url: ["image_url", "imagen", "url_imagen", "url_de_imagen", "image"],
  tipo: ["item_type", "tipo", "type"],
  variante: ["variant_name", "variante", "variant"],
} as const;

export type ImportField = keyof typeof IMPORT_ALIASES;
export type ExistingImportProduct = { id: string; name: string; sku: string | null; barcode: string | null; has_variants?: boolean };
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
  image_url: string;
  tipo: string;
  variante: string;
  fields: ImportField[];
  warnings: string[];
  original: Record<string, string>;
  error?: string | undefined;
  status: "valid" | "existing" | "error";
  existingId?: string | undefined;
};
export type ImportAnalysis = { rows: ProductImportRow[]; detected: string[]; unsupported: string[] };

export function normalizeImportHeader(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

// Decimal comma/dot and grouped thousands; never strip arbitrary invalid text to zero.
export function parseImportNumber(value: string): number {
  let text = value.trim().replace(/^(?:MXN|USD|EUR|\$|€)\s*/i, "").replace(/\s*(?:MXN|USD|EUR|\$|€)$/i, "").replace(/[\s\u00a0]/g, "");
  if (!/^-?\d+(?:[.,]\d+)*$/.test(text)) return NaN;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const [whole, fraction, extra] = text.split(decimal);
    if (extra !== undefined || !whole || !fraction || !new RegExp(`^-?\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(whole)) return NaN;
    text = whole.split(grouping).join("") + "." + fraction;
  } else if (comma >= 0) {
    if (/^-?\d{1,3}(?:,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
    else if ((text.match(/,/g) ?? []).length === 1) text = text.replace(",", ".");
    else return NaN;
  } else if ((text.match(/\./g) ?? []).length > 1) {
    if (!/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) return NaN;
    text = text.replace(/\./g, "");
  }
  const result = Number(text);
  return Number.isFinite(result) ? result : NaN;
}

export function analyzeProductGrid(grid: string[][], existing: ExistingImportProduct[]): ImportAnalysis {
  const headers = grid[0] ?? [];
  const fields = headers.map((header) => (Object.entries(IMPORT_ALIASES).find(([, aliases]) => (aliases as readonly string[]).includes(normalizeImportHeader(header)))?.[0] as ImportField | undefined));
  const detected = headers.filter((_, index) => fields[index] !== undefined);
  const unsupported = headers.filter((header, index) => header.trim() && (!fields[index] || fields[index] === "proveedor" || fields[index] === "tipo" || fields[index] === "variante"));
  const duplicates = fields.filter((field, index) => field && fields.indexOf(field) !== index);
  const bySku = new Map<string, ExistingImportProduct[]>();
  const byBarcode = new Map<string, ExistingImportProduct[]>();
  for (const product of existing) {
    for (const [value, map] of [[product.sku, bySku], [product.barcode, byBarcode]] as const) {
      if (value) { const key = value.trim().toLowerCase(); map.set(key, [...(map.get(key) ?? []), product]); }
    }
  }
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  const seenIds = new Set<string>();
  const rows: ProductImportRow[] = [];
  grid.slice(1).forEach((cells, index) => {
    if (!cells.some((cell) => cell.trim())) return;
    const values: Partial<Record<ImportField, string>> = {};
    const original: Record<string, string> = {};
    headers.forEach((header, column) => {
      const value = String(cells[column] ?? "").trim();
      original[header] = value;
      const field = fields[column];
      if (field) values[field] = value;
    });
    const present = (Object.keys(values) as ImportField[]).filter((field) => values[field] !== "");
    const errors: string[] = [];
    const warnings = unsupported.map((header) => `${header}: no se importará`);
    if (duplicates.length) errors.push(`Encabezados duplicados: ${duplicates.join(", ")}`);
    const skuMatches = bySku.get((values.sku ?? "").toLowerCase()) ?? [];
    const barcodeMatches = byBarcode.get((values.codigo_barras ?? "").toLowerCase()) ?? [];
    const match = skuMatches[0] ?? barcodeMatches[0];
    if (skuMatches.length > 1 || barcodeMatches.length > 1 || (skuMatches[0] && barcodeMatches[0] && skuMatches[0].id !== barcodeMatches[0].id)) errors.push("SKU/código ambiguo: coincide con productos diferentes");
    if (!values.nombre && !match) errors.push("Nombre vacío");
    if (values.variante || match?.has_variants) errors.push("Producto con variantes: importar desde este flujo no es compatible; no se convertirá en producto separado");
    if (values.image_url && !validImageUrl(values.image_url)) errors.push("URL de imagen inválida (usar http/https)");
    const numeric = { precio_venta: 0, costo: 0, stock: 0, minimo: 0, maximo: null as number | null };
    for (const field of ["precio_venta", "costo", "stock", "minimo", "maximo"] as const) {
      if (!present.includes(field)) continue;
      const value = parseImportNumber(values[field] ?? "");
      numeric[field] = value;
      if (!Number.isFinite(value) || value < 0) errors.push(`${field}: número inválido`);
    }
    if (numeric.maximo !== null && present.includes("minimo") && numeric.maximo < numeric.minimo) errors.push("Máximo no puede ser menor que mínimo");
    for (const [value, seen, label] of [[values.sku, seenSku, "SKU"], [values.codigo_barras, seenBarcode, "Código"]] as const) {
      if (value) { const key = value.toLowerCase(); if (seen.has(key)) errors.push(`${label} repetido en el archivo`); seen.add(key); }
    }
    if (match && seenIds.has(match.id)) errors.push("Producto repetido en el archivo");
    if (match) seenIds.add(match.id);
    rows.push({ row: index + 2, nombre: values.nombre ?? "", sku: values.sku ?? "", codigo_barras: values.codigo_barras ?? "", categoria: values.categoria ?? "", ...numeric, unidad: values.unidad ?? "", descripcion: values.descripcion ?? "", proveedor: values.proveedor ?? "", image_url: values.image_url ?? "", tipo: values.tipo ?? "", variante: values.variante ?? "", fields: present, warnings, original, error: errors.length ? errors.join("; ") : undefined, status: errors.length ? "error" : match ? "existing" : "valid", existingId: match?.id });
  });
  return { rows, detected, unsupported };
}

export function buildImportPayload(row: ProductImportRow, action: ImportAction): Record<string, string | number> | null {
  if (row.status === "error" || (row.status === "existing" && action === "skip_existing")) return null;
  const payload: Record<string, string | number> = { row: row.row, action };
  if (row.existingId) payload.existing_id = row.existingId;
  const isNew = row.status === "valid";
  const groups: ImportField[] = [];
  if (isNew || action === "update_all" || action === "update_data") groups.push("nombre", "sku", "codigo_barras", "categoria", "unidad", "descripcion", "image_url");
  if (isNew || action === "update_all" || action === "update_price_cost") groups.push("precio_venta", "costo");
  if (isNew || action === "update_all" || action === "update_stock") groups.push("stock", "minimo", "maximo");
  for (const field of groups) {
    const value = row[field];
    if (row.fields.includes(field) && (typeof value === "number" || typeof value === "string") && value !== "") payload[field] = value;
  }
  return payload;
}