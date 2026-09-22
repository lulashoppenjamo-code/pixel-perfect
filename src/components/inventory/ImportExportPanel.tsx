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
  type ProductImportRow,
  type ImportAction,
} from "@/lib/excel";

export function ImportExportPanel() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [action, setAction] = useState<ImportAction>("update_all");
  const [parsing, setParsing] = useState(false);

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

      const catByName = new Map(
        categories.map((c) => [c.name.toLowerCase(), c.id]),
      );

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const rejected = rows.filter((r) => r.status === "error").length;

      const workable = rows.filter((r) => r.status !== "error");

      for (const r of workable) {
        if (r.status === "existing" && action === "skip_existing") {
          skipped += 1;
          continue;
        }

        let categoryId: string | null = null;
        if (r.categoria) {
          categoryId = catByName.get(r.categoria.toLowerCase()) ?? null;
          if (!categoryId) {
            const { data: createdCat, error: catErr } = await supabase
              .from("categories")
              .insert({ name: r.categoria })
              .select("id")
              .single();
            if (!catErr && createdCat) {
              categoryId = createdCat.id;
              catByName.set(r.categoria.toLowerCase(), createdCat.id);
            }
          }
        }

        if (r.status === "existing" && r.existingId) {
          const patch: Record<string, unknown> = {};
          if (action === "update_all" || action === "update_data") {
            patch.name = r.nombre;
            patch.sku = r.sku || null;
            patch.barcode = r.codigo_barras || null;
            patch.description = r.descripcion || null;
            if (categoryId) patch.category_id = categoryId;
          }
          if (action === "update_all" || action === "update_price_cost") {
            patch.price = r.precio_venta;
            patch.cost = r.costo;
          }
          if (Object.keys(patch).length) {
            const { error } = await supabase
              .from("products")
              .update(patch)
              .eq("id", r.existingId);
            if (error) throw error;
          }
          if (action === "update_all" || action === "update_stock") {
            const { data: inv } = await supabase
              .from("inventory")
              .select("id")
              .eq("branch_id", branchId)
              .eq("product_id", r.existingId)
              .maybeSingle();
            if (inv) {
              await supabase
                .from("inventory")
                .update({
                  stock: r.stock,
                  min_stock: r.minimo,
                  max_stock: r.maximo,
                })
                .eq("id", inv.id);
            } else {
              await supabase.from("inventory").insert({
                branch_id: branchId,
                product_id: r.existingId,
                stock: r.stock,
                min_stock: r.minimo,
                max_stock: r.maximo,
              });
            }
          }
          updated += 1;
        } else {
          const { data: prod, error } = await supabase
            .from("products")
            .insert({
              name: r.nombre,
              sku: r.sku || null,
              barcode: r.codigo_barras || null,
              price: r.precio_venta,
              cost: r.costo,
              description: r.descripcion || null,
              category_id: categoryId,
              is_active: true,
              has_variants: false,
              tax_rate: 0,
            } as never)
            .select("id")
            .single();
          if (error) throw error;
          await supabase.from("inventory").insert({
            branch_id: branchId,
            product_id: prod.id,
            stock: r.stock,
            min_stock: r.minimo,
            max_stock: r.maximo,
          });
          created += 1;
        }
      }

      return { created, updated, skipped, rejected };
    },
    onSuccess: (r) => {
      toast.success(
        `Importación: ${r.created} creados, ${r.updated} actualizados, ${r.skipped} omitidos, ${r.rejected} rechazados`,
      );
      setRows([]);
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["import-existing-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
