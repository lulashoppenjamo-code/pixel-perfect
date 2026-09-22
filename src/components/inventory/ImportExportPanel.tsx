/**
 * Import / Export Excel — Inventario LULA OS (FASE 3)
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  parseProductFile,
  downloadTemplate,
  downloadWorkbook,
  downloadCsv,
  downloadImportErrors,
  downloadImportFailures,
  type ProductImportRow,
  type ImportAction,
} from "@/lib/excel";

// How many rows go into a single INSERT/UPSERT request. Big enough to
// cut round-trips drastically, small enough to keep each request quick.
const CHUNK_SIZE = 200;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function wantsProductPatch(action: ImportAction) {
  return action === "update_all" || action === "update_data" || action === "update_price_cost";
}

/**
 * Writes a batch of rows to `table` in as few requests as possible.
 * If a whole chunk fails (e.g. one bad row breaks the batch statement),
 * it falls back to writing that chunk's rows one by one so a single bad
 * row can't hide/rollback the rest of the chunk — this is what keeps the
 * import from silently truncating.
 */
async function bulkWrite(
  table: "products" | "inventory" | "categories",
  items: { payload: Record<string, unknown>; ref: ProductImportRow }[],
  mode: "insert" | "upsert",
  onConflict: string | undefined,
  failedRows: Map<number, string>,
  onChunkDone: () => void,
) {
  for (const group of chunkArray(items, CHUNK_SIZE)) {
    const batch = group.map((g) => g.payload);
    const { error } =
      mode === "upsert"
        ? await supabase.from(table).upsert(batch as never, onConflict ? { onConflict } : undefined)
        : await supabase.from(table).insert(batch as never);

    if (!error) {
      onChunkDone();
      continue;
    }

    // Isolate the bad row(s) in this chunk instead of losing the whole batch.
    for (const g of group) {
      const { error: singleErr } =
        mode === "upsert"
          ? await supabase
              .from(table)
              .upsert(g.payload as never, onConflict ? { onConflict } : undefined)
          : await supabase.from(table).insert(g.payload as never);
      if (singleErr && !failedRows.has(g.ref.row)) {
        failedRows.set(g.ref.row, singleErr.message);
      }
    }
    onChunkDone();
  }
}

export function ImportExportPanel() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [action, setAction] = useState<ImportAction>("update_all");
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [phase, setPhase] = useState("");
  const [lastFailures, setLastFailures] = useState<
    { row: number; nombre: string; message: string }[]
  >([]);

  const { data: existingProducts = [] } = useQuery({
    queryKey: ["import-existing-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        sku: string | null;
        barcode: string | null;
      }[];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["import-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const onFile = async (file: File) => {
    setParsing(true);
    try {
      const parsed = await parseProductFile(file, existingProducts);
      setRows(parsed);
      toast.success(`${parsed.length} filas analizadas`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al leer archivo");
    } finally {
      setParsing(false);
    }
  };

  const stats = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    existing: rows.filter((r) => r.status === "existing").length,
    error: rows.filter((r) => r.status === "error").length,
  };

  const doImport = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!isManager) throw new Error("Sin permiso para importar");

      const rejected = rows.filter((r) => r.status === "error").length;
      const toSkip = rows.filter((r) => r.status === "existing" && action === "skip_existing");
      const workable = rows.filter(
        (r) => r.status !== "error" && !(r.status === "existing" && action === "skip_existing"),
      );
      const skipped = toSkip.length;
      const failedRows = new Map<number, string>();

      const existingRows = workable.filter((r) => r.status === "existing" && r.existingId);
      const newRows = workable.filter((r) => !(r.status === "existing" && r.existingId));

      const existingChunks = chunkArray(existingRows, CHUNK_SIZE).length;
      const newChunks = chunkArray(newRows, CHUNK_SIZE).length;
      let totalOps = 0;
      if (existingRows.length && wantsProductPatch(action)) totalOps += existingChunks;
      if (newRows.length) totalOps += newChunks * 2; // products insert + inventory insert
      if (existingRows.length && (action === "update_all" || action === "update_stock")) {
        totalOps += existingChunks;
      }
      setProgress({ current: 0, total: Math.max(totalOps, 1) });
      const bump = () => setProgress((p) => ({ ...p, current: p.current + 1 }));

      // --- 1. Resolve / create the categories this batch needs, once ---
      setPhase("Preparando categorías…");
      const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
      const missing = new Map<string, string>();
      for (const r of workable) {
        if (r.categoria && !catByName.has(r.categoria.toLowerCase())) {
          missing.set(r.categoria.toLowerCase(), r.categoria);
        }
      }
      if (missing.size) {
        const toCreate = Array.from(missing.values()).map((name) => ({ name }));
        for (const group of chunkArray(toCreate, CHUNK_SIZE)) {
          const { data, error } = await supabase.from("categories").insert(group).select("id, name");
          if (!error && data) {
            for (const c of data) catByName.set(c.name.toLowerCase(), c.id);
          } else {
            for (const single of group) {
              const { data: d } = await supabase
                .from("categories")
                .insert(single)
                .select("id, name")
                .single();
              if (d) catByName.set(d.name.toLowerCase(), d.id);
            }
          }
        }
      }
      const categoryIdFor = (r: ProductImportRow) =>
        r.categoria ? catByName.get(r.categoria.toLowerCase()) ?? null : null;

      // --- 2. Current name + inventory rows for the products we'll touch (one query each, not one per row) ---
      const existingIds = existingRows.map((r) => r.existingId!);
      const currentById = new Map<string, { name: string }>();
      if (existingIds.length) {
        const { data: currentProducts } = await supabase
          .from("products")
          .select("id, name")
          .in("id", existingIds);
        for (const p of currentProducts ?? []) currentById.set(p.id, { name: p.name });
      }
      const invIdByProduct = new Map<string, string>();
      if (existingIds.length) {
        const { data: invRows } = await supabase
          .from("inventory")
          .select("id, product_id")
          .eq("branch_id", branchId)
          .in("product_id", existingIds);
        for (const i of invRows ?? []) invIdByProduct.set(i.product_id, i.id);
      }

      // --- 3. Update existing products (bulk upsert by id) ---
      if (existingRows.length && wantsProductPatch(action)) {
        setPhase("Actualizando productos…");
        const items = existingRows.map((r) => {
          const patch: Record<string, unknown> = {
            id: r.existingId,
            // "name" has no default in the DB, so it must always be sent —
            // default to the current value unless this action updates it.
            name: currentById.get(r.existingId!)?.name ?? r.nombre,
          };
          if (action === "update_all" || action === "update_data") {
            patch.name = r.nombre;
            patch.sku = r.sku || null;
            patch.barcode = r.codigo_barras || null;
            patch.description = r.descripcion || null;
            const cid = categoryIdFor(r);
            if (cid) patch.category_id = cid;
          }
          if (action === "update_all" || action === "update_price_cost") {
            patch.price = r.precio_venta;
            patch.cost = r.costo;
          }
          return { payload: patch, ref: r };
        });
        await bulkWrite("products", items, "upsert", "id", failedRows, bump);
      }

      // --- 4. Create new products (client-generated ids so inventory can link right away) ---
      const newIdByRow = new Map<number, string>();
      if (newRows.length) {
        setPhase("Creando productos nuevos…");
        const items = newRows.map((r) => {
          const id = crypto.randomUUID();
          newIdByRow.set(r.row, id);
          return {
            payload: {
              id,
              name: r.nombre,
              sku: r.sku || null,
              barcode: r.codigo_barras || null,
              price: r.precio_venta,
              cost: r.costo,
              description: r.descripcion || null,
              category_id: categoryIdFor(r),
              is_active: true,
              has_variants: false,
              tax_rate: 0,
            },
            ref: r,
          };
        });
        await bulkWrite("products", items, "insert", undefined, failedRows, bump);
      }

      // --- 5. New products always get an inventory row, regardless of the chosen action ---
      if (newRows.length) {
        setPhase("Creando inventario…");
        const items = newRows
          .filter((r) => !failedRows.has(r.row) && newIdByRow.has(r.row))
          .map((r) => ({
            payload: {
              branch_id: branchId,
              product_id: newIdByRow.get(r.row),
              stock: r.stock,
              min_stock: r.minimo,
              max_stock: r.maximo,
            },
            ref: r,
          }));
        if (items.length) {
          await bulkWrite("inventory", items, "insert", undefined, failedRows, bump);
        }
      }

      // --- 6. Existing products: only touch stock if the chosen action includes it ---
      if (existingRows.length && (action === "update_all" || action === "update_stock")) {
        setPhase("Actualizando stock…");
        const toUpdate: { payload: Record<string, unknown>; ref: ProductImportRow }[] = [];
        const toInsert: { payload: Record<string, unknown>; ref: ProductImportRow }[] = [];
        for (const r of existingRows) {
          if (failedRows.has(r.row) || !r.existingId) continue;
          const invId = invIdByProduct.get(r.existingId);
          const stockPayload = { stock: r.stock, min_stock: r.minimo, max_stock: r.maximo };
          if (invId) {
            // branch_id/product_id must ride along even on the update path —
            // they're NOT NULL columns with no default.
            toUpdate.push({
              payload: { id: invId, branch_id: branchId, product_id: r.existingId, ...stockPayload },
              ref: r,
            });
          } else {
            toInsert.push({
              payload: { branch_id: branchId, product_id: r.existingId, ...stockPayload },
              ref: r,
            });
          }
        }
        if (toUpdate.length) await bulkWrite("inventory", toUpdate, "upsert", "id", failedRows, bump);
        if (toInsert.length) await bulkWrite("inventory", toInsert, "insert", undefined, failedRows, bump);
      }

      setPhase("");
      setProgress((p) => ({ ...p, current: p.total }));

      const created = newRows.filter((r) => !failedRows.has(r.row)).length;
      const updated = existingRows.filter((r) => !failedRows.has(r.row)).length;
      const failures = Array.from(failedRows.entries()).map(([row, message]) => {
        const ref = workable.find((r) => r.row === row);
        return { row, nombre: ref?.nombre || "(sin nombre)", message };
      });

      return { created, updated, skipped, rejected, failures };
    },
    onSuccess: (r) => {
      setProgress({ current: 0, total: 0 });
      setPhase("");
      setLastFailures(r.failures);
      if (r.failures.length === 0) {
        toast.success(
          `Importación completa: ${r.created} creados, ${r.updated} actualizados, ${r.skipped} omitidos, ${r.rejected} rechazados`,
        );
      } else {
        toast.warning(
          `Importación terminada con ${r.failures.length} fila(s) con error: ${r.created} creados, ${r.updated} actualizados, ${r.skipped} omitidos, ${r.rejected} rechazados`,
        );
      }
      setRows([]);
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["import-existing-products"] });
    },
    onError: (e: Error) => {
      setProgress({ current: 0, total: 0 });
      setPhase("");
      toast.error(e.message);
    },
  });

  const exportInventory = async (fmt: "xlsx" | "csv") => {
    if (!branchId) return;
    const { data: inv } = await supabase
      .from("inventory")
      .select("stock, min_stock, max_stock, product_id, products(name, sku, barcode, price, cost)")
      .eq("branch_id", branchId);
    const rowsOut = (inv ?? []).map((i) => {
      const p = i.products as {
        name?: string;
        sku?: string;
        barcode?: string;
        price?: number;
        cost?: number;
      } | null;
      return {
        nombre: p?.name ?? "",
        sku: p?.sku ?? "",
        codigo_barras: p?.barcode ?? "",
        precio: p?.price ?? 0,
        costo: p?.cost ?? 0,
        stock: i.stock,
        minimo: i.min_stock,
        maximo: i.max_stock,
      };
    });
    if (fmt === "csv") await downloadCsv("inventario.csv", rowsOut);
    else await downloadWorkbook("inventario.xlsx", [{ name: "Inventario", rows: rowsOut }]);
    toast.success("Exportación lista");
  };

  if (!isManager) {
    return (
      <p className="text-sm text-muted-foreground">
        Solo managers pueden importar o exportar inventario.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" /> Importar Excel / CSV
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full gap-2" onClick={() => void downloadTemplate()}>
              <Download className="h-4 w-4" /> Descargar plantilla
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <Button
              className="w-full gap-2"
              disabled={parsing}
              onClick={() => fileRef.current?.click()}
            >
              <FileSpreadsheet className="h-4 w-4" />
              {parsing ? "Analizando…" : "Seleccionar archivo"}
            </Button>
            {doImport.isPending && progress.total > 0 && (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {phase || "Importando…"} ({progress.current}/{progress.total})
                </p>
              </div>
            )}
            {!doImport.isPending && lastFailures.length > 0 && (
              <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="text-xs text-destructive">
                  {lastFailures.length} fila(s) no se pudieron guardar
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1 p-1 text-xs"
                  onClick={() => void downloadImportFailures(lastFailures)}
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Descargar
                </Button>
              </div>
            )}
            {rows.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">{stats.total} filas</Badge>
                  <Badge className="bg-emerald-600">{stats.valid} válidos</Badge>
                  <Badge className="bg-amber-500">{stats.existing} existentes</Badge>
                  <Badge variant="destructive">{stats.error} errores</Badge>
                </div>
                <div>
                  <Label>Productos existentes</Label>
                  <Select value={action} onValueChange={(v) => setAction(v as ImportAction)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="update_all">Actualizar todo</SelectItem>
                      <SelectItem value="update_stock">Solo stock</SelectItem>
                      <SelectItem value="update_price_cost">Precio y costo</SelectItem>
                      <SelectItem value="update_data">Datos del producto</SelectItem>
                      <SelectItem value="skip_existing">No modificar existentes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {stats.error > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => void downloadImportErrors(rows)}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Descargar errores
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRows([])}>
                    Cancelar
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={doImport.isPending || stats.valid + stats.existing === 0}
                    onClick={() => {
                      if (
                        !confirm(
                          `Esta operación modificará hasta ${stats.valid + stats.existing} productos. ¿Continuar?`,
                        )
                      )
                        return;
                      doImport.mutate();
                    }}
                  >
                    {doImport.isPending ? "Importando…" : "Importar"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" /> Exportar
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => void exportInventory("xlsx")}>
              Inventario Excel
            </Button>
            <Button variant="outline" onClick={() => void exportInventory("csv")}>
              Inventario CSV
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
