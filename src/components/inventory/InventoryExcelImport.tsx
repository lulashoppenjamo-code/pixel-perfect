/**
 * UI para importar el Excel de inventario (CATEGORY, ITEM_NAME, …).
 * Colócalo en Inventario o Artículos (pestaña/panel).
 */
import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  importInventoryRows,
  parseInventoryWorkbook,
} from "@/lib/importInventory";
import { useQueryClient } from "@tanstack/react-query";

export function InventoryExcelImport({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const onFile = async (file: File | null) => {
    if (!file || !enabled) return;

    setBusy(true);
    setProgress("Leyendo archivo…");

    try {
      const buffer = await file.arrayBuffer();
      const rows = parseInventoryWorkbook(buffer);

      if (!rows.length) {
        toast.error("No se encontraron filas válidas en el Excel");
        return;
      }

      toast.message(`Importando ${rows.length} productos…`);

      const result = await importInventoryRows(rows, (done, total) => {
        setProgress(`${done} / ${total}`);
      });

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["shared-inventory"] }),
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["categories"] }),
      ]);

      toast.success(
        `Listo: ${result.created} nuevos, ${result.updated} actualizados` +
          (result.skipped ? `, ${result.skipped} con error` : ""),
      );

      if (result.errors.length) {
        console.warn("Import errors", result.errors.slice(0, 30));
        toast.message(
          `Revisa la consola: ${result.errors.length} avisos`,
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo importar el archivo",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
      <CardHeader className="border-b border-[#f0f0f0] pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-[#212121]">
          <FileSpreadsheet className="h-5 w-5 text-[#1a73e8]" />
          Importar inventario (Excel)
        </CardTitle>
        <p className="text-xs text-[#757575]">
          Formato: CATEGORY, ITEM_TYPE, ITEM_NAME, VARIANT_NAME, PRICE,
          COST_PRICE, STOCK, BARCODE, SKU. Si el código viene vacío se
          genera uno único de 10 caracteres.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#e0e0e0] bg-[#fafafa] px-4 py-8 transition hover:border-[#1a73e8] hover:bg-[#e8f0fe]/50">
          <Upload className="mb-2 h-8 w-8 text-[#1a73e8]" />
          <span className="text-sm font-semibold text-[#212121]">
            {busy ? "Importando…" : "Elegir archivo .xlsx"}
          </span>
          {progress ? (
            <span className="mt-1 text-xs text-[#757575]">{progress}</span>
          ) : (
            <span className="mt-1 text-xs text-[#9e9e9e]">
              Hasta ~3,000 filas · no borra productos existentes
            </span>
          )}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={busy || !enabled}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onFile(f);
            }}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className="w-full rounded-xl"
          disabled
        >
          Tip: haz un respaldo antes de importar en producción
        </Button>
      </CardContent>
    </Card>
  );
}
