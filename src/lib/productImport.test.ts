import { describe, test, expect } from "bun:test";
import { analyzeProductGrid, buildImportPayload, parseImportNumber, validImageUrl } from "./productImport";
import { analyzeProductFile } from "./excel";
import * as XLSX from "xlsx";

const existing = [{ id: "one", name: "Original", sku: "0012", barcode: "00042" }];
const grid = [["ITEM NAME", "SKU", "Código-de barras", "PRICE", "COST_PRICE", "STOCK", "MIN STOCK", "MAX_STOCK", "UNIT", "DESCRIPTION", "IMAGE_URL"], ["Nuevo nombre", "0012", "00042", "$1,234.56", "12,5", "35", "2", "50", "kg", "Detalle", "https://example.org/product.jpg"]];

describe("inventory import rules", () => {
  test("normalizes Spanish/English headings and preserves textual IDs", () => {
    const row = analyzeProductGrid(grid, existing).rows[0];
    expect(row?.sku).toBe("0012"); expect(row?.codigo_barras).toBe("00042"); expect(row?.status).toBe("existing"); expect(row?.costo).toBe(12.5);
  });
  test("imported stock is final 35, not existing 20 plus 35", () => {
    const row = analyzeProductGrid(grid, existing).rows[0];
    if (!row) throw new Error("missing row");
    expect(buildImportPayload(row,"update_stock")?.stock).toBe(35);
  });
  for (const [action, keys] of [
    ["update_stock", ["row","action","existing_id","stock","minimo","maximo"]],
    ["update_price_cost", ["row","action","existing_id","precio_venta","costo"]],
    ["update_data", ["row","action","existing_id","nombre","sku","codigo_barras","unidad","descripcion","image_url"]],
    ["update_all", ["row","action","existing_id","nombre","sku","codigo_barras","unidad","descripcion","image_url","precio_venta","costo","stock","minimo","maximo"]],
  ] as const) test(`${action} sends only its fields`, () => {
    const row = analyzeProductGrid(grid,existing).rows[0]; if (!row) throw new Error("missing row");
    expect(Object.keys(buildImportPayload(row,action) ?? {}).sort()).toEqual([...keys].sort());
  });
  test("skip_existing never sends existing products", () => { const row = analyzeProductGrid(grid,existing).rows[0]; if (!row) throw new Error("missing row"); expect(buildImportPayload(row,"skip_existing")).toBeNull(); });
  test("blank fields are omitted, explicit zero is kept", () => {
    const row = analyzeProductGrid([["SKU","price","stock","description"],["0012","0","",""]],existing).rows[0]; if (!row) throw new Error("missing row");
    const payload = buildImportPayload(row,"update_all"); expect(payload?.precio_venta).toBe(0); expect(payload).not.toHaveProperty("stock"); expect(payload).not.toHaveProperty("descripcion"); expect(payload).not.toHaveProperty("nombre");
  });
  test("variants are rejected, not flattened into products", () => { expect(analyzeProductGrid([["ITEM_NAME","VARIANT_NAME"],["Camisa","Rojo"]],[]).rows[0]?.status).toBe("error"); });
  test("unknown and unsupported fields are reported", () => { expect(analyzeProductGrid([["nombre","SUPPLIER","ITEM_TYPE","custom"],["Uno","ACME","goods","x"]],[]).unsupported).toEqual(["SUPPLIER","ITEM_TYPE","custom"]); });
  test("numeric errors retain original value and row number", () => { const row = analyzeProductGrid([["nombre","stock"],["Uno",""],["Dos","abc"]],[]).rows[1]; expect(row?.row).toBe(3); expect(row?.status).toBe("error"); expect(row?.original.stock).toBe("abc"); });
  test("invalid min/max and duplicate products are rejected", () => { const rows=analyzeProductGrid([["nombre","sku","min","max"],["Uno","x","5","2"],["Dos","x","0","3"]],[]).rows; expect(rows.map(r=>r.status)).toEqual(["error","error"]); });
  test("number formats and invalid strings", () => { expect(parseImportNumber("1.234,56")).toBe(1234.56); expect(parseImportNumber("1,234")).toBe(1234); expect(parseImportNumber("0,5")).toBe(0.5); expect(parseImportNumber("abc12")).toBeNaN(); });
  test("image URL permits only http/https without credentials", () => { expect(validImageUrl("https://example.org/image.png")).toBe(true); expect(validImageUrl("javascript:alert(1)")).toBe(false); expect(validImageUrl("https://user:pass@example.org/a")).toBe(false); });
  test("CSV keeps zero-prefixed identifiers", async () => { const result=await analyzeProductFile(new File(["nombre,SKU,BARCODE,STOCK\nUno,0012,00042,35"],"products.csv"),existing); expect(result.rows[0]?.sku).toBe("0012"); expect(result.rows[0]?.codigo_barras).toBe("00042"); });
  test("Excel displayed zero-padding is preserved", async () => {
    const ws=XLSX.utils.aoa_to_sheet([["nombre","sku","barcode"],["Uno",12,42]]); if(ws.B2) ws.B2.z="0000"; if(ws.C2) ws.C2.z="00000";
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Productos");
    const data=XLSX.write(wb,{type:"array",bookType:"xlsx"}); const result=await analyzeProductFile(new File([data],"products.xlsx"),existing);
    expect(result.rows[0]?.sku).toBe("0012"); expect(result.rows[0]?.codigo_barras).toBe("00042");
  });
});