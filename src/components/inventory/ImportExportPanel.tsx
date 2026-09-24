/**
 * Import / Export Excel — Inventario compartido LULA OS
 *
 * IMPORTANTE:
 * - shared_inventory es la existencia real.
 * - branch_id solamente identifica quién/desde qué sucursal
 *   realizó el movimiento.
 * - Nunca se escribe directamente en la tabla legacy inventory.
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

const CHUNK_SIZE = 200;

function chunkArray<T>(
  array: T[],
  size: number,
): T[][] {
  const result: T[][] = [];

  for (
    let index = 0;
    index < array.length;
    index += size
  ) {
    result.push(
      array.slice(index, index + size),
    );
  }

  return result;
}

function wantsProductPatch(
  action: ImportAction,
) {
  return (
    action === "update_all" ||
    action === "update_data" ||
    action === "update_price_cost"
  );
}

async function bulkWriteProducts(
  items: {
    payload: Record<string, unknown>;
    ref: ProductImportRow;
  }[],
  mode: "insert" | "upsert",
  failedRows: Map<number, string>,
  onChunkDone: () => void,
) {
  for (
    const group of chunkArray(
      items,
      CHUNK_SIZE,
    )
  ) {
    const payload = group.map(
      (item) => item.payload,
    );

    const result =
      mode === "upsert"
        ? await supabase
            .from("products")
            .upsert(
              payload as never,
              {
                onConflict: "id",
              },
            )
        : await supabase
            .from("products")
            .insert(
              payload as never,
            );

    if (!result.error) {
      onChunkDone();
      continue;
    }

    for (const item of group) {
      const single =
        mode === "upsert"
          ? await supabase
              .from("products")
              .upsert(
                item.payload as never,
                {
                  onConflict: "id",
                },
              )
          : await supabase
              .from("products")
              .insert(
                item.payload as never,
              );

      if (
        single.error &&
        !failedRows.has(item.ref.row)
      ) {
        failedRows.set(
          item.ref.row,
          single.error.message,
        );
      }
    }

    onChunkDone();
  }
}

export function ImportExportPanel() {
  const {
    isManager,
    profile,
  } = useAuth();

  const qc = useQueryClient();

  const fileRef =
    useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<
    ProductImportRow[]
  >([]);

  const [action, setAction] =
    useState<ImportAction>(
      "update_all",
    );

  const [parsing, setParsing] =
    useState(false);

  const [progress, setProgress] =
    useState({
      current: 0,
      total: 0,
    });

  const [phase, setPhase] =
    useState("");

  const [lastFailures, setLastFailures] =
    useState<
      {
        row: number;
        nombre: string;
        message: string;
      }[]
    >([]);

  /*
   * ============================================================
   * SUCURSAL DEL USUARIO
   *
   * Se usa únicamente como contexto del movimiento.
   * El stock continúa siendo central.
   * ============================================================
   */

  const branchId =
    profile?.branch_id ?? null;

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const {
    data: existingProducts = [],
  } = useQuery({
    queryKey: [
      "import-existing-products-shared",
    ],

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("products")
        .select(
          "id, name, sku, barcode",
        );

      if (error) {
        throw error;
      }

      return (data ?? []) as {
        id: string;
        name: string;
        sku: string | null;
        barcode: string | null;
      }[];
    },
  });

  /*
   * ============================================================
   * CATEGORÍAS
   * ============================================================
   */

  const {
    data: categories = [],
  } = useQuery({
    queryKey: [
      "import-categories",
    ],

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("categories")
        .select(
          "id, name",
        );

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  /*
   * ============================================================
   * ARCHIVO
   * ============================================================
   */

  const onFile = async (
    file: File,
  ) => {
    setParsing(true);

    try {
      const parsed =
        await parseProductFile(
          file,
          existingProducts,
        );

      setRows(parsed);

      toast.success(
        `${parsed.length} filas analizadas`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al leer archivo",
      );
    } finally {
      setParsing(false);
    }
  };

  /*
   * ============================================================
   * ESTADÍSTICAS
   * ============================================================
   */

  const stats = {
    total: rows.length,

    valid: rows.filter(
      (row) =>
        row.status === "valid",
    ).length,

    existing: rows.filter(
      (row) =>
        row.status === "existing",
    ).length,

    error: rows.filter(
      (row) =>
        row.status === "error",
    ).length,
  };

  /*
   * ============================================================
   * IMPORTACIÓN
   * ============================================================
   */

  const doImport = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "Sin permiso para importar",
        );
      }

      /*
       * Para registrar movimientos correctamente,
       * necesitamos conocer la sucursal del usuario.
       */

      if (!branchId) {
        throw new Error(
          "Tu usuario no tiene una sucursal asignada. No se puede registrar el movimiento de inventario.",
        );
      }

      const rejected =
        rows.filter(
          (row) =>
            row.status ===
            "error",
        ).length;

      const skippedRows =
        rows.filter(
          (row) =>
            row.status ===
              "existing" &&
            action ===
              "skip_existing",
        );

      const workable =
        rows.filter(
          (row) =>
            row.status !==
              "error" &&
            !(
              row.status ===
                "existing" &&
              action ===
                "skip_existing"
            ),
        );

      const failedRows =
        new Map<
          number,
          string
        >();

      const existingRows =
        workable.filter(
          (row) =>
            row.status ===
              "existing" &&
            row.existingId,
        );

      const newRows =
        workable.filter(
          (row) =>
            !(
              row.status ===
                "existing" &&
              row.existingId
            ),
        );

      const existingChunks =
        chunkArray(
          existingRows,
          CHUNK_SIZE,
        ).length;

      const newChunks =
        chunkArray(
          newRows,
          CHUNK_SIZE,
        ).length;

      let totalOperations =
        0;

      if (
        existingRows.length &&
        wantsProductPatch(
          action,
        )
      ) {
        totalOperations +=
          existingChunks;
      }

      if (newRows.length) {
        totalOperations +=
          newChunks;

        totalOperations +=
          newChunks;
      }

      if (
        existingRows.length &&
        (
          action ===
            "update_all" ||
          action ===
            "update_stock"
        )
      ) {
        totalOperations +=
          existingChunks;
      }

      setProgress({
        current: 0,
        total: Math.max(
          totalOperations,
          1,
        ),
      });

      const bump = () => {
        setProgress(
          (previous) => ({
            ...previous,

            current:
              previous.current +
              1,
          }),
        );
      };

      /*
       * ========================================================
       * CATEGORÍAS
       * ========================================================
       */

      setPhase(
        "Preparando categorías...",
      );

      const categoryByName =
        new Map(
          categories.map(
            (category) => [
              category.name.toLowerCase(),
              category.id,
            ],
          ),
        );

      const missingCategories =
        new Map<
          string,
          string
        >();

      for (
        const row of workable
      ) {
        if (
          row.categoria &&
          !categoryByName.has(
            row.categoria.toLowerCase(),
          )
        ) {
          missingCategories.set(
            row.categoria.toLowerCase(),
            row.categoria,
          );
        }
      }

      if (
        missingCategories.size
      ) {
        const categoryRows =
          Array.from(
            missingCategories.values(),
          ).map(
            (name) => ({
              name,
            }),
          );

        for (
          const group of
            chunkArray(
              categoryRows,
              CHUNK_SIZE,
            )
        ) {
          const {
            data,
            error,
          } = await supabase
            .from("categories")
            .insert(group)
            .select(
              "id, name",
            );

          if (
            !error &&
            data
          ) {
            for (
              const category of
                data
            ) {
              categoryByName.set(
                category.name.toLowerCase(),
                category.id,
              );
            }
          } else {
            for (
              const category of
                group
            ) {
              const {
                data: created,
              } =
                await supabase
                  .from(
                    "categories",
                  )
                  .insert(
                    category,
                  )
                  .select(
                    "id, name",
                  )
                  .single();

              if (
                created
              ) {
                categoryByName.set(
                  created.name.toLowerCase(),
                  created.id,
                );
              }
            }
          }
        }
      }

      const categoryIdFor = (
        row: ProductImportRow,
      ) =>
        row.categoria
          ? categoryByName.get(
              row.categoria.toLowerCase(),
            ) ?? null
          : null;

      /*
       * ========================================================
       * PRODUCTOS EXISTENTES
       * ========================================================
       */

      const existingIds =
        existingRows.map(
          (row) =>
            row.existingId!,
        );

      const currentById =
        new Map<
          string,
          string
        >();

      if (
        existingIds.length
      ) {
        const {
          data:
            currentProducts,
        } =
          await supabase
            .from(
              "products",
            )
            .select(
              "id, name",
            )
            .in(
              "id",
              existingIds,
            );

        for (
          const product of
            currentProducts ??
            []
        ) {
          currentById.set(
            product.id,
            product.name,
          );
        }
      }

      /*
       * ========================================================
       * ACTUALIZAR PRODUCTOS
       * ========================================================
       */

      if (
        existingRows.length &&
        wantsProductPatch(
          action,
        )
      ) {
        setPhase(
          "Actualizando productos...",
        );

        const items =
          existingRows.map(
            (row) => {
              const patch: Record<
                string,
                unknown
              > = {
                id:
                  row.existingId,

                name:
                  currentById.get(
                    row.existingId!,
                  ) ??
                  row.nombre,
              };

              if (
                action ===
                  "update_all" ||
                action ===
                  "update_data"
              ) {
                patch["name"] =
                  row.nombre;

                patch["sku"] =
                  row.sku ||
                  null;

                patch["barcode"] =
                  row.codigo_barras ||
                  null;

                patch["description"] =
                  row.descripcion ||
                  null;

                patch["category_id"] =
                  categoryIdFor(
                    row,
                  );
              }

              if (
                action ===
                  "update_all" ||
                action ===
                  "update_price_cost"
              ) {
                patch["price"] =
                  row.precio_venta;

                patch["cost"] =
                  row.costo;
              }

              return {
                payload: patch,
                ref: row,
              };
            },
          );

        await bulkWriteProducts(
          items,
          "upsert",
          failedRows,
          bump,
        );
      }

      /*
       * ========================================================
       * CREAR PRODUCTOS
       * ========================================================
       */

      const newIdByRow =
        new Map<
          number,
          string
        >();

      if (
        newRows.length
      ) {
        setPhase(
          "Creando productos nuevos...",
        );

        const items =
          newRows.map(
            (row) => {
              const id =
                crypto.randomUUID();

              newIdByRow.set(
                row.row,
                id,
              );

              return {
                payload: {
                  id,

                  name:
                    row.nombre,

                  sku:
                    row.sku ||
                    null,

                  barcode:
                    row.codigo_barras ||
                    null,

                  price:
                    row.precio_venta,

                  cost:
                    row.costo,

                  description:
                    row.descripcion ||
                    null,

                  category_id:
                    categoryIdFor(
                      row,
                    ),

                  is_active:
                    true,

                  has_variants:
                    false,

                  tax_rate:
                    0,
                },

                ref: row,
              };
            },
          );

        await bulkWriteProducts(
          items,
          "insert",
          failedRows,
          bump,
        );
      }

      /*
       * ========================================================
       * STOCK NUEVO
       *
       * IMPORTANTE:
       * adjust_stock() escribe en shared_inventory.
       *
       * branch_id solamente queda como contexto histórico
       * del movimiento.
       * ========================================================
       */

      if (
        newRows.length
      ) {
        setPhase(
          "Cargando stock compartido...",
        );

        for (
          const row of newRows
        ) {
          if (
            failedRows.has(
              row.row,
            )
          ) {
            continue;
          }

          const productId =
            newIdByRow.get(
              row.row,
            );

          if (!productId) {
            continue;
          }

          if (
            Number(
              row.stock,
            ) !== 0
          ) {
            const {
              error,
            } =
              await supabase.rpc(
                "adjust_stock",
                {
                  _branch_id:
                    branchId,

                  _product_id:
                    productId,

                  _quantity:
                    Number(
                      row.stock,
                    ),

                  _notes:
                    "Stock inicial por importación",
                },
              );

            if (error) {
              failedRows.set(
                row.row,
                error.message,
              );
            }
          }

          /*
           * Límites centrales.
           */

          const {
            error:
              limitError,
          } =
            await supabase.rpc(
              "set_shared_inventory_limits",
              {
                _product_id:
                  productId,

                _min_stock:
                  Number(
                    row.minimo,
                  ) || 0,

                _max_stock:
                  row.maximo ===
                    null ||
                  row.maximo ===
                    undefined
                    ? null
                    : Number(
                        row.maximo,
                      ),
              },
            );

          if (
            limitError &&
            !failedRows.has(
              row.row,
            )
          ) {
            failedRows.set(
              row.row,
              limitError.message,
            );
          }
        }

        bump();
      }

      /*
       * ========================================================
       * STOCK EXISTENTE
       * ========================================================
       *
       * El Excel contiene existencia final.
       *
       * Por eso:
       *
       * stock objetivo - stock actual = ajuste
       *
       * Nunca sobrescribimos directamente shared_inventory.
       * ========================================================
       */

      if (
        existingRows.length &&
        (
          action ===
            "update_all" ||
          action ===
            "update_stock"
        )
      ) {
        setPhase(
          "Actualizando stock compartido...",
        );

        for (
          const row of
            existingRows
        ) {
          if (
            failedRows.has(
              row.row,
            ) ||
            !row.existingId
          ) {
            continue;
          }

          const {
            data: current,
            error:
              currentError,
          } =
            await supabase.rpc(
              "get_shared_product_stock",
              {
                _product_id:
                  row.existingId,
              },
            );

          if (
            currentError
          ) {
            failedRows.set(
              row.row,
              currentError.message,
            );

            continue;
          }

          const currentRow =
            Array.isArray(
              current,
            )
              ? current[0]
              : current;

          const currentStock =
            Number(
              currentRow?.stock ??
                0,
            );

          const targetStock =
            Number(
              row.stock,
            );

          const delta =
            targetStock -
            currentStock;

          if (
            delta !== 0
          ) {
            const {
              error,
            } =
              await supabase.rpc(
                "adjust_stock",
                {
                  _branch_id:
                    branchId,

                  _product_id:
                    row.existingId,

                  _quantity:
                    delta,

                  _notes:
                    "Actualización de stock por importación",
                },
              );

            if (error) {
              failedRows.set(
                row.row,
                error.message,
              );

              continue;
            }
          }

          /*
           * Actualizar límites centrales.
           */

          const {
            error:
              limitError,
          } =
            await supabase.rpc(
              "set_shared_inventory_limits",
              {
                _product_id:
                  row.existingId,

                _min_stock:
                  Number(
                    row.minimo,
                  ) || 0,

                _max_stock:
                  row.maximo ===
                    null ||
                  row.maximo ===
                    undefined
                    ? null
                    : Number(
                        row.maximo,
                      ),
              },
            );

          if (
            limitError &&
            !failedRows.has(
              row.row,
            )
          ) {
            failedRows.set(
              row.row,
              limitError.message,
            );
          }
        }

        bump();
      }

      setPhase("");

      setProgress(
        (previous) => ({
          ...previous,
          current:
            previous.total,
        }),
      );

      const created =
        newRows.filter(
          (row) =>
            !failedRows.has(
              row.row,
            ),
        ).length;

      const updated =
        existingRows.filter(
          (row) =>
            !failedRows.has(
              row.row,
            ),
        ).length;

      const failures =
        Array.from(
          failedRows.entries(),
        ).map(
          ([
            row,
            message,
          ]) => {
            const reference =
              workable.find(
                (item) =>
                  item.row ===
                  row,
              );

            return {
              row,

              nombre:
                reference?.nombre ??
                "(sin nombre)",

              message,
            };
          },
        );

      return {
        created,

        updated,

        skipped:
          skippedRows.length,

        rejected,

        failures,
      };
    },

    onSuccess: (
      result,
    ) => {
      setProgress({
        current: 0,
        total: 0,
      });

      setPhase("");

      setLastFailures(
        result.failures,
      );

      if (
        !result.failures.length
      ) {
        toast.success(
          `Importación completa: ${result.created} creados, ${result.updated} actualizados, ${result.skipped} omitidos, ${result.rejected} rechazados`,
        );
      } else {
        toast.warning(
          `Importación terminada con ${result.failures.length} error(es)`,
        );
      }

      setRows([]);

      void qc.invalidateQueries({
        queryKey: [
          "shared-inventory",
        ],
      });

      void qc.invalidateQueries({
        queryKey: [
          "pos-products-shared",
        ],
      });

      void qc.invalidateQueries({
        queryKey: [
          "pos-variant-inventory-shared",
        ],
      });

      void qc.invalidateQueries({
        queryKey: [
          "import-existing-products-shared",
        ],
      });
    },

    onError: (
      error: Error,
    ) => {
      setProgress({
        current: 0,
        total: 0,
      });

      setPhase("");

      toast.error(
        error.message,
      );
    },
  });

  /*
   * ============================================================
   * EXPORTAR
   * ============================================================
   */

  const exportInventory =
    async (
      format:
        | "xlsx"
        | "csv",
    ) => {
      const {
        data,
        error,
      } =
        await supabase.rpc(
          "get_shared_inventory",
        );

      if (error) {
        toast.error(
          error.message,
        );

        return;
      }

      const output =
        (data ?? []).map(
          (
            item: {
              product_name?: string;
              sku?: string | null;
              barcode?: string | null;
              price?: number;
              cost?: number;
              stock?: number;
              min_stock?: number;
              max_stock?: number | null;
            },
          ) => ({
            nombre:
              item.product_name ??
              "",

            sku:
              item.sku ??
              "",

            codigo_barras:
              item.barcode ??
              "",

            precio_venta:
              item.price ??
              0,

            costo:
              item.cost ??
              0,

            stock:
              item.stock ??
              0,

            minimo:
              item.min_stock ??
              0,

            maximo:
              item.max_stock ??
              "",
          }),
        );

      if (
        format ===
        "csv"
      ) {
        await downloadCsv(
          "inventario-compartido.csv",
          output,
        );
      } else {
        await downloadWorkbook(
          "inventario-compartido.xlsx",
          [
            {
              name:
                "Inventario",
              rows: output,
            },
          ],
        );
      }

      toast.success(
        "Exportación lista",
      );
    };

  /*
   * ============================================================
   * PERMISOS
   * ============================================================
   */

  if (!isManager) {
    return (
      <p className="text-sm text-muted-foreground">
        Solo managers pueden
        importar o exportar
        inventario.
      </p>
    );
  }

  /*
   * ============================================================
   * UI
   * ============================================================
   */

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">

        {/* ======================================================
            IMPORTAR
        ====================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />

              Importar Excel / CSV
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() =>
                void downloadTemplate()
              }
            >
              <Download className="h-4 w-4" />

              Descargar plantilla
            </Button>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(
                event,
              ) => {
                const file =
                  event.target.files?.[0];

                if (file) {
                  void onFile(
                    file,
                  );
                }

                event.target.value =
                  "";
              }}
            />

            <Button
              className="w-full gap-2"
              disabled={parsing}
              onClick={() =>
                fileRef.current?.click()
              }
            >
              <FileSpreadsheet className="h-4 w-4" />

              {parsing
                ? "Analizando..."
                : "Seleccionar archivo"}
            </Button>

            {doImport.isPending &&
              progress.total >
                0 && (
                <div className="space-y-1">

                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          (progress.current /
                            progress.total) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {phase ||
                      "Importando..."}{" "}
                    (
                    {
                      progress.current
                    }
                    /
                    {
                      progress.total
                    }
                    )
                  </p>

                </div>
              )}

            {!doImport.isPending &&
              lastFailures.length >
                0 && (
                <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">

                  <p className="text-xs text-destructive">
                    {
                      lastFailures.length
                    }{" "}
                    fila(s) no
                    se pudieron
                    guardar.
                  </p>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1 p-1 text-xs"
                    onClick={() =>
                      void downloadImportFailures(
                        lastFailures,
                      )
                    }
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />

                    Descargar
                  </Button>

                </div>
              )}

            {rows.length >
              0 && (
              <>

                <div className="flex flex-wrap gap-2 text-sm">

                  <Badge variant="secondary">
                    {
                      stats.total
                    }{" "}
                    filas
                  </Badge>

                  <Badge className="bg-emerald-600">
                    {
                      stats.valid
                    }{" "}
                    válidos
                  </Badge>

                  <Badge className="bg-amber-500">
                    {
                      stats.existing
                    }{" "}
                    existentes
                  </Badge>

                  <Badge variant="destructive">
                    {
                      stats.error
                    }{" "}
                    errores
                  </Badge>

                </div>

                <div>
                  <Label>
                    Productos
                    existentes
                  </Label>

                  <Select
                    value={
                      action
                    }
                    onValueChange={(
                      value,
                    ) =>
                      setAction(
                        value as ImportAction,
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>

                      <SelectItem value="update_all">
                        Actualizar todo
                      </SelectItem>

                      <SelectItem value="update_stock">
                        Solo stock
                      </SelectItem>

                      <SelectItem value="update_price_cost">
                        Precio y costo
                      </SelectItem>

                      <SelectItem value="update_data">
                        Datos del producto
                      </SelectItem>

                      <SelectItem value="skip_existing">
                        No modificar existentes
                      </SelectItem>

                    </SelectContent>
                  </Select>
                </div>

                {stats.error >
                  0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() =>
                      void downloadImportErrors(
                        rows,
                      )
                    }
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />

                    Descargar errores
                  </Button>
                )}

                <div className="flex gap-2">

                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() =>
                      setRows(
                        [],
                      )
                    }
                  >
                    Cancelar
                  </Button>

                  <Button
                    className="flex-1"
                    disabled={
                      doImport.isPending ||
                      stats.valid +
                        stats.existing ===
                        0
                    }
                    onClick={() => {
                      if (
                        !confirm(
                          `Esta operación modificará hasta ${
                            stats.valid +
                            stats.existing
                          } productos. ¿Continuar?`,
                        )
                      ) {
                        return;
                      }

                      doImport.mutate();
                    }}
                  >
                    {doImport.isPending
                      ? "Importando..."
                      : "Importar"}
                  </Button>

                </div>

              </>
            )}

          </CardContent>
        </Card>

        {/* ======================================================
            EXPORTAR
        ====================================================== */}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" />

              Exportar
            </CardTitle>
          </CardHeader>

          <CardContent className="flex flex-col gap-2">

            <Button
              variant="outline"
              onClick={() =>
                void exportInventory(
                  "xlsx",
                )
              }
            >
              Inventario Excel
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                void exportInventory(
                  "csv",
                )
              }
            >
              Inventario CSV
            </Button>

          </CardContent>
        </Card>

      </div>
    </div>
  );
}