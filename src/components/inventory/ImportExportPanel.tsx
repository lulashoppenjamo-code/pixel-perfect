/**
 * Import / Export Excel — Inventario compartido LULA OS (RÁPIDO)
 *
 * Usa RPC bulk_import_products por lotes de 500:
 * categorías, productos, precios, costos, códigos y stock central.
 *
 * Requiere migración:
 * supabase/migrations/20261007220000_bulk_import_products.sql
 */

import { useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Download,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

const BATCH_SIZE = 500;

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function ImportExportPanel() {
  const { isManager, isAdmin, profile } = useAuth();
  const { branchId: activeBranchId, branches } = useBranch();
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

  const branchId =
    activeBranchId ??
    profile?.branch_id ??
    (isAdmin || isManager ? branches[0]?.id ?? null : null);

  const { data: existingProducts = [] } = useQuery({
    queryKey: ["import-existing-products-shared"],
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

  const onFile = async (file: File) => {
    setParsing(true);
    try {
      const parsed = await parseProductFile(file, existingProducts);
      setRows(parsed);
      toast.success(`${parsed.length} filas analizadas`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al leer archivo",
      );
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
      if (!isManager) {
        throw new Error("Sin permiso para importar");
      }

      if (!branchId) {
        throw new Error(
          "No hay sucursal activa. Crea o selecciona una sucursal arriba y vuelve a intentar.",
        );
      }

      const workable = rows.filter((row) => {
        if (row.status === "error") return false;
        if (row.status === "existing" && action === "skip_existing") {
          return false;
        }
        return true;
      });

      if (!workable.length) {
        throw new Error("No hay filas válidas para importar");
      }

      const batches = chunkArray(workable, BATCH_SIZE);
      setProgress({ current: 0, total: batches.length });

      let created = 0;
      let updated = 0;
      let stockSet = 0;
      const failures: { row: number; nombre: string; message: string }[] =
        [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]!;
        setPhase(
          `Importando lote ${i + 1}/${batches.length} (${batch.length} productos)...`,
        );

        const payload = batch.map((row) => {
          // Si skip price/stock según action
          const includePrice =
            action === "update_all" ||
            action === "update_price_cost" ||
            row.status === "valid";
          const includeStock =
            action === "update_all" ||
            action === "update_stock" ||
            row.status === "valid";
          const includeData =
            action === "update_all" ||
            action === "update_data" ||
            row.status === "valid";

          return {
            nombre: includeData ? row.nombre : row.nombre,
            sku: includeData ? row.sku : row.sku,
            codigo_barras: includeData ? row.codigo_barras : row.codigo_barras,
            categoria: includeData ? row.categoria : row.categoria,
            precio_venta: includePrice ? row.precio_venta : row.precio_venta,
            costo: includePrice ? row.costo : row.costo,
            stock: includeStock ? row.stock : row.stock,
            minimo: row.minimo,
            maximo: row.maximo,
            descripcion: row.descripcion,
          };
        });

        const { data, error } = await (supabase as any).rpc(
          "bulk_import_products",
          {
            _items: payload,
            _branch_id: branchId,
          },
        );

        if (error) {
          // Si la RPC no existe aún, error claro
          if (
            error.message?.includes("could not find") ||
            error.code === "PGRST202"
          ) {
            throw new Error(
              "Falta instalar la función bulk_import_products en Supabase. Ejecuta la migración SQL que te entregamos.",
            );
          }
          throw error;
        }

        const result = data as {
          created?: number;
          updated?: number;
          stock_set?: number;
          errors?: { nombre?: string; error?: string }[];
        };

        created += Number(result.created ?? 0);
        updated += Number(result.updated ?? 0);
        stockSet += Number(result.stock_set ?? 0);

        for (const err of result.errors ?? []) {
          failures.push({
            row: 0,
            nombre: err.nombre ?? "?",
            message: err.error ?? "error",
          });
        }

        setProgress({ current: i + 1, total: batches.length });
      }

      setLastFailures(failures);
      setPhase("");

      return { created, updated, stockSet, failures: failures.length };
    },

    onSuccess: (result) => {
      toast.success(
        `Listo: ${result.created} nuevos, ${result.updated} actualizados, stock en ${result.stockSet}` +
          (result.failures ? ` · ${result.failures} con error` : ""),
      );

      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
      void qc.invalidateQueries({ queryKey: ["import-existing-products-shared"] });
      void qc.invalidateQueries({ queryKey: ["pos-products-shared"] });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (!isManager) {
    return null;
  }

  return (
    <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
      <CardHeader className="border-b border-[#f0f0f0] pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-[#212121]">
          <FileSpreadsheet className="h-5 w-5 text-[#1a73e8]" />
          Importar / Exportar inventario
        </CardTitle>
        <p className="text-xs text-[#757575]">
          Importación masiva por lotes de {BATCH_SIZE}: categorías, códigos,
          precios, costos y stock central en segundos.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {!branchId && (
          <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              Selecciona una sucursal arriba (solo contextualiza el movimiento;
              el stock es central).
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-xl"
            onClick={() => void downloadTemplate()}
          >
            <Download className="mr-2 h-4 w-4" />
            Plantilla
          </Button>

          <Button
            type="button"
            variant="outline"
            className="min-h-11 rounded-xl"
            disabled={parsing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {parsing ? "Leyendo…" : "Elegir Excel"}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFile(f);
            }}
          />
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Total {stats.total}</Badge>
              <Badge className="bg-[#e8f5e9] text-[#2e7d32]">
                Nuevos {stats.valid}
              </Badge>
              <Badge className="bg-[#e8f0fe] text-[#1a73e8]">
                Existentes {stats.existing}
              </Badge>
              {stats.error > 0 && (
                <Badge className="bg-[#fce4ec] text-[#c2185b]">
                  Errores {stats.error}
                </Badge>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Acción sobre existentes</Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as ImportAction)}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="update_all">
                    Actualizar todo (datos + precio + stock)
                  </SelectItem>
                  <SelectItem value="update_stock">Solo stock</SelectItem>
                  <SelectItem value="update_price_cost">
                    Solo precio y costo
                  </SelectItem>
                  <SelectItem value="update_data">
                    Solo datos (nombre, código, categoría)
                  </SelectItem>
                  <SelectItem value="skip_existing">
                    Saltar existentes
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {phase && (
              <p className="text-sm font-medium text-[#1a73e8]">{phase}</p>
            )}
            {progress.total > 0 && (
              <p className="text-xs text-[#757575]">
                Lote {progress.current} / {progress.total}
              </p>
            )}

            <Button
              type="button"
              className="min-h-12 w-full rounded-xl bg-[#34a853] text-[15px] font-bold text-white hover:bg-[#2d8f47]"
              disabled={doImport.isPending || !branchId}
              onClick={() => doImport.mutate()}
            >
              {doImport.isPending
                ? "Importando…"
                : `Importar ahora (${stats.valid + (action === "skip_existing" ? 0 : stats.existing)} filas)`}
            </Button>

            {stats.error > 0 && (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={() => void downloadImportErrors(rows)}
              >
                Descargar filas con error
              </Button>
            )}

            {lastFailures.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={() => void downloadImportFailures(lastFailures)}
              >
                Descargar fallas del último import
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
