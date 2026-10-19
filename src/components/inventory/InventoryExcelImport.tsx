/** Compatibility entry: all mounted import screens share the reviewed importer. */
import { ImportExportPanel } from "@/components/inventory/ImportExportPanel";

export function InventoryExcelImport({ enabled = true }: { enabled?: boolean }) {
  return enabled ? <ImportExportPanel /> : null;
}
