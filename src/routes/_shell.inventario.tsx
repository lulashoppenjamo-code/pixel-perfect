import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Package,
  Play,
  CheckCircle2,
  History,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import {
  getSharedInventory,
  setSharedInventoryLimits,
} from "@/lib/sharedInventory";
import { money, shortDate } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { ImportExportPanel } from "@/components/inventory/ImportExportPanel";
import { RestockList } from "@/components/inventory/RestockList";
import { PhysicalCountProgress } from "@/components/inventory/PhysicalCountProgress";

/**
 * BLOQUE 4 — Visual Inventario (tabs, filtros, tarjetas de existencia).
 * Solo presentación. NO toca inventario compartido, RPCs ni arquitectura.
 */

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      {
        title: "Inventario — Lula OS",
      },
      {
        name: "description",
        content:
          "Inventario compartido, ajustes, conteo físico, límites e historial.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="inventario">
      <InventarioPage />
    </RequireNavAccess>
  ),
});

type InventoryRow = Awaited<
  ReturnType<typeof getSharedInventory>
>[number];

type CountRow = {
  id: string;
  branch_id: string;
  status: string;
  notes: string | null;
  started_by: string | null;
  completed_by: string | null;
  started_at: string;
  completed_at: string | null;
};

type CountItemRow = {
  id: string;
  count_id: string;
  product_id: string;
  variant_id: string | null;
  system_stock: number;
  counted_stock: number | null;
  difference: number | null;
  unit_cost: number;
  difference_value: number | null;
  counted_at: string | null;
  products:
    | {
        name: string;
        sku: string | null;
      }
    | null;
};

const MOVEMENT_LABELS: Record<string, string> = {
  sale: "Venta",
  return: "Devolución",
  purchase: "Compra",
  adjustment_in: "Ajuste +",
  adjustment_out: "Ajuste −",
  transfer_in: "Entrada",
  transfer_out: "Salida",
};

function InventarioPage() {
  const { isManager } = useAuth();
  const { branchId, branches, loading: branchLoading } = useBranch();
  const queryClient = useQueryClient();

  const activeBranch = branches.find(
    (branch) => branch.id === branchId,
  );

  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustDirection, setAdjustDirection] =
    useState<"in" | "out">("in");

  const [limitProduct, setLimitProduct] = useState("");
  const [limitMin, setLimitMin] = useState("0");
  const [limitMax, setLimitMax] = useState("");

  const [countFilter, setCountFilter] = useState("");
  /** Filtro visual de existencias (client-side, no cambia consulta). */
  const [stockStatusFilter, setStockStatusFilter] = useState<
    "all" | "low" | "out"
  >("all");
  const [countNotes, setCountNotes] = useState("");

  const [physicalCount, setPhysicalCount] =
    useState<Record<string, string>>({});

  const invalidateInventory = () => {
    void queryClient.invalidateQueries({
      queryKey: ["shared-inventory"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["pos-products-shared"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["pos-variant-inventory-shared"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-movements"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-counts"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-count-items"],
    });
  };

  const {
    data: inventory = [],
    isLoading: inventoryLoading,
    error: inventoryError,
  } = useQuery({
    queryKey: ["shared-inventory"],
    queryFn: getSharedInventory,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["inv-products-shared"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode")
        .eq("is_active", true)
        .order("name");

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "id,type,quantity,notes,created_at,products(name)",
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(100);

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const {
    data: inventoryCounts = [],
    isLoading: countsLoading,
  } = useQuery({
    queryKey: ["inventory-counts", branchId],
    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("inventory_counts")
          .select(
            `
            id,
            branch_id,
            status,
            notes,
            started_by,
            completed_by,
            started_at,
            completed_at
          `,
          )
          .eq("branch_id", branchId!)
          .order("started_at", {
            ascending: false,
          })
          .limit(30);

      if (error) {
        throw error;
      }

      return (data ?? []) as CountRow[];
    },
  });

  const activeCount =
    inventoryCounts.find(
      (count) => count.status === "counting",
    ) ?? null;

  const {
    data: activeCountItems = [],
    isLoading: activeCountItemsLoading,
  } = useQuery({
    queryKey: [
      "inventory-count-items",
      activeCount?.id,
    ],

    enabled: !!activeCount?.id,

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("inventory_count_items")
          .select(
            `
            id,
            count_id,
            product_id,
            variant_id,
            system_stock,
            counted_stock,
            difference,
            unit_cost,
            difference_value,
            counted_at,
            products(name,sku)
          `,
          )
          .eq("count_id", activeCount!.id)
          .order("product_id");

      if (error) {
        throw error;
      }

      return (data ?? []) as CountItemRow[];
    },
  });

  const lowStock = useMemo(
    () =>
      inventory.filter(
        (row) =>
          Number(row.available_stock) <=
          Number(row.min_stock),
      ),
    [inventory],
  );

  const filteredInventory = useMemo(() => {
    if (stockStatusFilter === "all") return inventory;
    return inventory.filter((row) => {
      const available = Number(row.available_stock);
      const minimum = Number(row.min_stock);
      if (stockStatusFilter === "out") return available <= 0;
      if (stockStatusFilter === "low")
        return available > 0 && available <= minimum;
      return true;
    });
  }, [inventory, stockStatusFilter]);

  const filteredCountItems = useMemo(() => {
    const query = countFilter.trim().toLowerCase();

    if (!query) {
      return activeCountItems;
    }

    return activeCountItems.filter((item) => {
      const name = item.products?.name ?? "";
      const sku = item.products?.sku ?? "";

      return (
        name.toLowerCase().includes(query) ||
        sku.toLowerCase().includes(query)
      );
    });
  }, [activeCountItems, countFilter]);

  const countSummary = useMemo(() => {
    const total = activeCountItems.length;

    const counted = activeCountItems.filter(
      (item) => item.counted_stock !== null,
    ).length;

    const pending = total - counted;

    const shortageUnits =
      activeCountItems.reduce((sum, item) => {
        const diff = Number(item.difference ?? 0);

        return (
          sum +
          (diff < 0 ? Math.abs(diff) : 0)
        );
      }, 0);

    const surplusUnits =
      activeCountItems.reduce((sum, item) => {
        const diff = Number(item.difference ?? 0);

        return sum + (diff > 0 ? diff : 0);
      }, 0);

    const shortageValue =
      activeCountItems.reduce((sum, item) => {
        const value = Number(
          item.difference_value ?? 0,
        );

        return (
          sum +
          (value < 0 ? Math.abs(value) : 0)
        );
      }, 0);

    const surplusValue =
      activeCountItems.reduce((sum, item) => {
        const value = Number(
          item.difference_value ?? 0,
        );

        return sum + (value > 0 ? value : 0);
      }, 0);

    return {
      total,
      counted,
      pending,
      shortageUnits,
      surplusUnits,
      shortageValue,
      surplusValue,
    };
  }, [activeCountItems]);

  const startCount = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "No tienes permisos para iniciar un inventario físico.",
        );
      }

      if (!branchId) {
        throw new Error(
          "Selecciona una sucursal activa antes de continuar.",
        );
      }

      if (activeCount) {
        throw new Error(
          "Ya existe un inventario físico abierto.",
        );
      }

      const { data, error } =
        await (supabase as any).rpc(
          "start_inventory_count",
          {
            _branch_id: branchId,
            _notes: countNotes || null,
          },
        );

      if (error) {
        throw error;
      }

      return data as string;
    },

    onSuccess: () => {
      toast.success(
        "Inventario físico iniciado.",
      );

      setCountNotes("");
      invalidateInventory();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const setCountItem = useMutation({
    mutationFn: async ({
      itemId,
      value,
    }: {
      itemId: string;
      value: number;
    }) => {
      if (!isManager) {
        throw new Error(
          "No tienes permisos para capturar inventario físico.",
        );
      }

      if (!activeCount) {
        throw new Error(
          "No existe un inventario físico activo.",
        );
      }

      if (
        !Number.isFinite(value) ||
        value < 0
      ) {
        throw new Error(
          "La cantidad física no es válida.",
        );
      }

      const { error } =
        await (supabase as any).rpc(
          "set_inventory_count_item",
          {
            _count_id: activeCount.id,
            _item_id: itemId,
            _counted_stock: value,
          },
        );

      if (error) {
        throw error;
      }
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          "inventory-count-items",
          activeCount?.id,
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const completeCount = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "No tienes permisos para cerrar el inventario físico.",
        );
      }

      if (!activeCount) {
        throw new Error(
          "No existe un inventario físico activo.",
        );
      }

      if (countSummary.pending > 0) {
        throw new Error(
          `Faltan ${countSummary.pending} productos por contar.`,
        );
      }

      const { error } =
        await (supabase as any).rpc(
          "complete_inventory_count",
          {
            _count_id: activeCount.id,
          },
        );

      if (error) {
        throw error;
      }
    },

    onSuccess: () => {
      toast.success(
        "Inventario físico cerrado y diferencias aplicadas.",
      );

      setPhysicalCount({});
      setCountFilter("");

      invalidateInventory();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const adjustInventory = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "No tienes permisos para ajustar inventario.",
        );
      }

      if (!branchId) {
        throw new Error(
          "Selecciona una sucursal activa antes de continuar.",
        );
      }

      if (!adjustProduct) {
        throw new Error(
          "Selecciona un producto.",
        );
      }

      const quantity = Math.abs(
        Number(adjustQuantity),
      );

      if (
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        throw new Error(
          "La cantidad debe ser mayor que cero.",
        );
      }

      const signedQuantity =
        adjustDirection === "in"
          ? quantity
          : -quantity;

      const { error } = await supabase.rpc(
        "adjust_stock",
        {
          _branch_id: branchId,
          _product_id: adjustProduct,
          _quantity: signedQuantity,
          _notes:
            adjustNotes ||
            (adjustDirection === "in"
              ? "Ajuste de entrada"
              : "Ajuste de salida"),
        },
      );

      if (error) {
        throw error;
      }
    },

    onSuccess: () => {
      toast.success(
        "Inventario compartido ajustado correctamente.",
      );

      setAdjustQuantity("");
      setAdjustNotes("");

      invalidateInventory();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateLimits = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "No tienes permisos para modificar límites.",
        );
      }

      if (!limitProduct) {
        throw new Error(
          "Selecciona un producto.",
        );
      }

      const min = Number(limitMin);

      if (
        !Number.isFinite(min) ||
        min < 0
      ) {
        throw new Error(
          "El mínimo no es válido.",
        );
      }

      const max =
        limitMax.trim() === ""
          ? null
          : Number(limitMax);

      if (
        max !== null &&
        (!Number.isFinite(max) ||
          max < 0)
      ) {
        throw new Error(
          "El máximo no es válido.",
        );
      }

      if (
        max !== null &&
        max < min
      ) {
        throw new Error(
          "El máximo no puede ser menor que el mínimo.",
        );
      }

      await setSharedInventoryLimits(
        limitProduct,
        null,
        min,
        max,
      );
    },

    onSuccess: () => {
      toast.success(
        "Límites actualizados.",
      );

      invalidateInventory();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const productOptions = products.map(
    (product) => (
      <SelectItem
        key={product.id}
        value={product.id}
      >
        {product.name}
        {product.sku
          ? ` (${product.sku})`
          : ""}
      </SelectItem>
    ),
  );

  return (
    <PageShell>
      <PageHeader
        icon={Boxes}
        title="Inventario"
        description="Inventario único compartido entre las sucursales."
        action={
          lowStock.length > 0 ? (
            <Badge
              variant="destructive"
              className="min-h-8 gap-1 rounded-full px-3"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {lowStock.length} bajo mínimo
            </Badge>
          ) : undefined
        }
      />

      {inventoryError && (
        <Card className="border-destructive/30">
          <CardContent className="pt-5 text-sm text-destructive sm:pt-6">
            Error al cargar inventario:{" "}
            {(inventoryError as Error).message}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="existencias">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="flex h-auto w-max min-w-full flex-nowrap gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm">
            <TabsTrigger
              value="existencias"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Existencias
            </TabsTrigger>

            <TabsTrigger
              value="ajuste"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Ajuste
            </TabsTrigger>

            <TabsTrigger
              value="limites"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Límites
            </TabsTrigger>

            <TabsTrigger
              value="conteo"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              <ClipboardList className="mr-1 h-3.5 w-3.5" />
              Inventario físico
            </TabsTrigger>

            <TabsTrigger
              value="historial"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              <History className="mr-1 h-3.5 w-3.5" />
              Historial físico
            </TabsTrigger>

            <TabsTrigger
              value="movimientos"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Movimientos
            </TabsTrigger>

            <TabsTrigger
              value="reposicion"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              <ClipboardList className="mr-1 h-3.5 w-3.5" />
              Reposición
            </TabsTrigger>

            <TabsTrigger
              value="importar"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
              Importar / Exportar
            </TabsTrigger>
          </TabsList>
        </div>

        {/* =====================================================
         * EXISTENCIAS
         * ===================================================== */}
        <TabsContent
          value="existencias"
          className="mt-3 sm:mt-4"
        >
          <Card className="overflow-hidden border-[#e0e0e0] shadow-sm">
            <CardHeader className="border-b border-[#f0f0f0] pb-3">
              <CardTitle className="text-base font-bold text-[#212121]">
                Existencias compartidas
              </CardTitle>

              <p className="text-xs leading-5 text-[#757575]">
                Una sola existencia para ambas sucursales.
              </p>
            </CardHeader>

            <CardContent className="px-3 pt-3 sm:px-6">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                {(
                  [
                    ["all", "Todos"],
                    ["low", "Inventario bajo"],
                    ["out", "Agotado"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStockStatusFilter(key)}
                    className={
                      stockStatusFilter === key
                        ? "shrink-0 rounded-full bg-[#7c4dff] px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm"
                        : "shrink-0 rounded-full bg-[#eeeeee] px-3.5 py-1.5 text-[12px] font-medium text-[#616161]"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* CELULAR / TABLET */}
              <div className="grid gap-2 lg:hidden">
                {inventoryLoading && (
                  <div className="rounded-2xl border border-[#e0e0e0] bg-white p-10 text-center shadow-sm">
                    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />
                    <p className="text-sm font-medium text-[#757575]">
                      Cargando inventario…
                    </p>
                  </div>
                )}

                {!inventoryLoading &&
                  inventory.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[#e0e0e0] bg-white px-5 py-12 text-center shadow-sm">
                      <Package className="mx-auto mb-3 h-10 w-10 text-[#c5cad3]" />
                      <p className="text-sm font-bold text-[#212121]">
                        Sin existencias registradas
                      </p>
                      <p className="mt-1 text-xs text-[#9aa3b8]">
                        Los productos aparecerán aquí al registrar stock
                      </p>
                    </div>
                  )}

                {!inventoryLoading &&
                  filteredInventory.length === 0 &&
                  inventory.length > 0 && (
                    <div className="rounded-2xl border border-dashed border-[#e0e0e0] bg-white px-5 py-10 text-center shadow-sm">
                      <p className="text-sm font-medium text-[#757575]">
                        Ningún ítem en este filtro
                      </p>
                    </div>
                  )}

                {!inventoryLoading &&
                  filteredInventory.map(
                    (row: InventoryRow) => {
                      const available =
                        Number(
                          row.available_stock,
                        );

                      const minimum =
                        Number(
                          row.min_stock,
                        );

                      const isOut =
                        available <= 0;

                      const isLow =
                        available <= minimum;

                      return (
                        <div
                          key={`${row.product_id}-${row.variant_id ?? "base"}`}
                          className={cn(
                            "rounded-xl border border-[#e0e0e0] bg-white p-3 shadow-sm",
                            isOut && "border-[#f8bbd0]",
                            isLow &&
                              !isOut &&
                              "border-[#ffe0b2] bg-[#fffaf5]",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f5f5f5] text-xl">
                              {row.emoji ?? "📦"}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="break-words text-sm font-bold leading-5 text-[#212121]">
                                  {row.product_name}
                                </p>

                                {isOut ? (
                                  <span className="shrink-0 rounded-full bg-[#fce4ec] px-2 py-0.5 text-[10px] font-bold text-[#c2185b]">
                                    Agotado
                                  </span>
                                ) : isLow ? (
                                  <span className="shrink-0 rounded-full bg-[#fff3e0] px-2 py-0.5 text-[10px] font-bold text-[#e65100]">
                                    Bajo
                                  </span>
                                ) : (
                                  <span className="shrink-0 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-bold text-[#2e7d32]">
                                    OK
                                  </span>
                                )}
                              </div>

                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                {row.sku && (
                                  <span className="text-[11px] font-medium text-[#9e9e9e]">
                                    {row.sku}
                                  </span>
                                )}

                                {row.variant_id && (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-[#e0e0e0] text-[10px]"
                                  >
                                    Variante
                                  </Badge>
                                )}
                              </div>

                              <p className="mt-1 text-xs text-[#757575]">
                                {available} en existencia
                                {minimum > 0
                                  ? ` · mín. ${minimum}`
                                  : ""}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#f0f0f0] pt-3">
                            <InventoryMetric
                              label="Stock"
                              value={String(
                                Number(
                                  row.stock,
                                ),
                              )}
                            />

                            <InventoryMetric
                              label="Reservado"
                              value={String(
                                Number(
                                  row.reserved_stock,
                                ),
                              )}
                            />

                            <InventoryMetric
                              label="Disponible"
                              value={String(
                                available,
                              )}
                              emphasis
                              danger={isLow}
                            />
                          </div>
                        </div>
                      );
                    },
                  )}
              </div>

              {/* PANTALLA GRANDE */}
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        Producto
                      </TableHead>

                      <TableHead>
                        SKU
                      </TableHead>

                      <TableHead className="text-right">
                        Stock
                      </TableHead>

                      <TableHead className="text-right">
                        Reservado
                      </TableHead>

                      <TableHead className="text-right">
                        Disponible
                      </TableHead>

                      <TableHead className="text-right">
                        Mín.
                      </TableHead>

                      <TableHead className="text-right">
                        Estado
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {inventoryLoading && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center"
                        >
                          Cargando inventario...
                        </TableCell>
                      </TableRow>
                    )}

                    {!inventoryLoading &&
                      inventory.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="py-10 text-center text-muted-foreground"
                          >
                            <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                            Sin existencias registradas.
                          </TableCell>
                        </TableRow>
                      )}

                    {filteredInventory.map(
                      (row: InventoryRow) => {
                        const available =
                          Number(
                            row.available_stock,
                          );

                        const minimum =
                          Number(
                            row.min_stock,
                          );

                        const isOut =
                          available <= 0;

                        const isLow =
                          available <= minimum;

                        return (
                          <TableRow
                            key={`${row.product_id}-${row.variant_id ?? "base"}`}
                            className={cn(
                              isLow &&
                                "bg-destructive/5",
                            )}
                          >
                            <TableCell className="font-medium">
                              {row.emoji ?? "📦"}{" "}
                              {row.product_name}

                              {row.variant_id && (
                                <Badge
                                  variant="outline"
                                  className="ml-2"
                                >
                                  Variante
                                </Badge>
                              )}
                            </TableCell>

                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {row.sku ?? "—"}
                            </TableCell>

                            <TableCell className="text-right font-semibold">
                              {Number(row.stock)}
                            </TableCell>

                            <TableCell className="text-right">
                              {Number(
                                row.reserved_stock,
                              )}
                            </TableCell>

                            <TableCell className="text-right font-semibold">
                              {available}
                            </TableCell>

                            <TableCell className="text-right">
                              {minimum}
                            </TableCell>

                            <TableCell className="text-right">
                              {isOut ? (
                                <Badge variant="destructive">
                                  Agotado
                                </Badge>
                              ) : isLow ? (
                                <Badge variant="destructive">
                                  Bajo
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  OK
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      },
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* =====================================================
         * AJUSTE
         * ===================================================== */}
        <TabsContent
          value="ajuste"
          className="mt-3 sm:mt-4"
        >
          <Card className="w-full lg:max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Ajuste directo
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  Producto
                </Label>

                <Select
                  value={adjustProduct}
                  onValueChange={
                    setAdjustProduct
                  }
                >
                  <SelectTrigger className="min-h-11 w-full rounded-xl">
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>

                  <SelectContent>
                    {productOptions}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    Dirección
                  </Label>

                  <Select
                    value={adjustDirection}
                    onValueChange={(value) =>
                      setAdjustDirection(
                        value as
                          | "in"
                          | "out",
                      )
                    }
                  >
                    <SelectTrigger className="min-h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="in">
                        Entrada (+)
                      </SelectItem>

                      <SelectItem value="out">
                        Salida (−)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Cantidad
                  </Label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adjustQuantity}
                    onChange={(event) =>
                      setAdjustQuantity(
                        event.target.value,
                      )
                    }
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Motivo
                </Label>

                <Input
                  value={adjustNotes}
                  onChange={(event) =>
                    setAdjustNotes(
                      event.target.value,
                    )
                  }
                  placeholder="Merma, daño, corrección..."
                  className="h-11 rounded-xl"
                />
              </div>

              <Button
                className="min-h-11 w-full touch-manipulation rounded-xl"
                disabled={
                  !isManager ||
                  !branchId ||
                  !adjustProduct ||
                  !adjustQuantity ||
                  adjustInventory.isPending
                }
                onClick={() =>
                  adjustInventory.mutate()
                }
              >
                {adjustInventory.isPending
                  ? "Aplicando..."
                  : "Aplicar ajuste"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* =====================================================
         * LIMITES
         * ===================================================== */}
        <TabsContent
          value="limites"
          className="mt-3 sm:mt-4"
        >
          <Card className="w-full lg:max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Mínimo / máximo
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  Producto
                </Label>

                <Select
                  value={limitProduct}
                  onValueChange={
                    setLimitProduct
                  }
                >
                  <SelectTrigger className="min-h-11 w-full rounded-xl">
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>

                  <SelectContent>
                    {productOptions}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    Mínimo
                  </Label>

                  <Input
                    type="number"
                    min="0"
                    value={limitMin}
                    onChange={(event) =>
                      setLimitMin(
                        event.target.value,
                      )
                    }
                    className="h-11 rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Máximo
                  </Label>

                  <Input
                    type="number"
                    min="0"
                    value={limitMax}
                    onChange={(event) =>
                      setLimitMax(
                        event.target.value,
                      )
                    }
                    placeholder="Sin límite"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>

              <Button
                className="min-h-11 w-full touch-manipulation rounded-xl"
                disabled={
                  !isManager ||
                  !limitProduct ||
                  updateLimits.isPending
                }
                onClick={() =>
                  updateLimits.mutate()
                }
              >
                {updateLimits.isPending
                  ? "Guardando..."
                  : "Guardar límites"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* =====================================================
         * INVENTARIO FISICO
         * ===================================================== */}
        <TabsContent
          value="conteo"
          className="mt-3 max-w-full overflow-x-hidden sm:mt-4"
        >
          {!activeCount ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-5 w-5 shrink-0" />
                  Nuevo inventario físico
                </CardTitle>
              </CardHeader>

              <CardContent className="w-full space-y-4 lg:max-w-xl">
                <div className="rounded-xl border bg-muted/30 p-3.5 text-sm sm:p-4">
                  <p className="font-medium">
                    Antes de comenzar
                  </p>

                  <p className="mt-1 leading-5 text-muted-foreground">
                    Lula OS tomará una fotografía
                    del stock teórico actual y
                    después podrás capturar las
                    existencias físicas.
                  </p>

                  <p className="mt-2 leading-5 text-muted-foreground">
                    Al cerrar el conteo se
                    calcularán automáticamente
                    faltantes, sobrantes y su
                    valor económico.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Notas del inventario
                  </Label>

                  <Input
                    value={countNotes}
                    onChange={(event) =>
                      setCountNotes(
                        event.target.value,
                      )
                    }
                    placeholder="Ej. Inventario mensual septiembre"
                    className="h-11 rounded-xl"
                  />
                </div>

                <Button
                  className="min-h-11 w-full touch-manipulation rounded-xl"
                  disabled={
                    !isManager ||
                    !branchId ||
                    startCount.isPending
                  }
                  onClick={() =>
                    startCount.mutate()
                  }
                >
                  <Play className="mr-2 h-4 w-4" />

                  {startCount.isPending
                    ? "Iniciando..."
                    : "Iniciar inventario físico"}
                </Button>

                {!isManager && (
                  <p className="text-xs text-muted-foreground">
                    Solo managers pueden iniciar
                    un inventario físico.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              <PhysicalCountProgress
                startedAt={
                  activeCount.started_at
                }
                total={countSummary.total}
                counted={countSummary.counted}
                pending={countSummary.pending}
                completed={false}
              />

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ClipboardList className="h-5 w-5 shrink-0" />
                        Inventario físico en curso
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Iniciado{" "}
                        {shortDate(
                          activeCount.started_at,
                        )}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      className="min-h-11 w-full touch-manipulation rounded-xl sm:w-auto"
                      disabled={
                        !isManager ||
                        countSummary.pending >
                          0 ||
                        completeCount.isPending
                      }
                      onClick={() =>
                        completeCount.mutate()
                      }
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />

                      {completeCount.isPending
                        ? "Cerrando..."
                        : "Cerrar inventario"}
                    </Button>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
                    <CountKpi
                      label="Productos"
                      value={String(
                        countSummary.total,
                      )}
                    />

                    <CountKpi
                      label="Contados"
                      value={String(
                        countSummary.counted,
                      )}
                    />

                    <CountKpi
                      label="Pendientes"
                      value={String(
                        countSummary.pending,
                      )}
                      danger={
                        countSummary.pending > 0
                      }
                    />

                    <CountKpi
                      label="Faltante"
                      value={`${countSummary.shortageUnits} uds`}
                      danger={
                        countSummary.shortageUnits >
                        0
                      }
                    />

                    <CountKpi
                      label="Faltante $"
                      value={money(
                        countSummary.shortageValue,
                      )}
                      danger={
                        countSummary.shortageValue >
                        0
                      }
                    />
                  </div>

                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
                    <div className="rounded-xl border p-3.5">
                      <p className="text-xs text-muted-foreground">
                        Sobrante
                      </p>

                      <p className="text-lg font-bold">
                        {
                          countSummary.surplusUnits
                        }{" "}
                        uds
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {money(
                          countSummary.surplusValue,
                        )}
                      </p>
                    </div>

                    <div className="rounded-xl border p-3.5">
                      <p className="text-xs text-muted-foreground">
                        Valor económico faltante
                      </p>

                      <p className="text-lg font-bold text-destructive">
                        {money(
                          countSummary.shortageValue,
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        Captura física
                      </CardTitle>

                      <p className="text-xs leading-5 text-muted-foreground">
                        Captura la cantidad real
                        encontrada.
                      </p>
                    </div>

                    <Input
                      value={countFilter}
                      onChange={(event) =>
                        setCountFilter(
                          event.target.value,
                        )
                      }
                      placeholder="Buscar producto o SKU..."
                      className="h-11 w-full rounded-xl sm:w-64"
                    />
                  </div>
                </CardHeader>

                <CardContent className="px-3 sm:px-6">
                  {activeCountItemsLoading ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Cargando productos...
                    </div>
                  ) : (
                    <>
                      {/* CELULAR / TABLET */}
                      <div className="grid gap-2.5 lg:hidden">
                        {filteredCountItems.map(
                          (item) => {
                            const counted =
                              item.counted_stock;

                            const difference =
                              Number(
                                item.difference ??
                                  0,
                              );

                            const differenceValue =
                              Number(
                                item.difference_value ??
                                  0,
                              );

                            return (
                              <div
                                key={item.id}
                                className="rounded-xl border bg-card p-3.5 shadow-sm"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-bold leading-5">
                                      {item.products
                                        ?.name ??
                                        "Producto"}
                                    </p>

                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      {item.products
                                        ?.sku && (
                                        <span className="font-mono text-[11px] text-muted-foreground">
                                          {
                                            item
                                              .products
                                              .sku
                                          }
                                        </span>
                                      )}

                                      {item.variant_id && (
                                        <Badge
                                          variant="outline"
                                          className="rounded-full text-[10px]"
                                        >
                                          Variante
                                        </Badge>
                                      )}
                                    </div>
                                  </div>

                                  {item.counted_stock ===
                                  null ? (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 rounded-full"
                                    >
                                      Pendiente
                                    </Badge>
                                  ) : difference <
                                    0 ? (
                                    <Badge
                                      variant="destructive"
                                      className="shrink-0 rounded-full"
                                    >
                                      Faltante
                                    </Badge>
                                  ) : difference >
                                    0 ? (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 rounded-full"
                                    >
                                      Sobrante
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 rounded-full"
                                    >
                                      Coincide
                                    </Badge>
                                  )}
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2">
                                  <div className="rounded-lg bg-muted/40 p-2.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Teórico
                                    </p>

                                    <p className="mt-1 text-base font-bold">
                                      {
                                        item.system_stock
                                      }
                                    </p>
                                  </div>

                                  <div className="rounded-lg border p-2.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Físico
                                    </p>

                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="mt-1 h-11 min-h-11 w-full touch-manipulation rounded-lg text-right text-base"
                                      value={
                                        physicalCount[
                                          item.id
                                        ] ??
                                        (counted !==
                                        null
                                          ? String(
                                              counted,
                                            )
                                          : "")
                                      }
                                      onChange={(
                                        event,
                                      ) => {
                                        const value =
                                          event
                                            .target
                                            .value;

                                        setPhysicalCount(
                                          (
                                            previous,
                                          ) => ({
                                            ...previous,
                                            [item.id]:
                                              value,
                                          }),
                                        );
                                      }}
                                      onBlur={(
                                        event,
                                      ) => {
                                        const value =
                                          Number(
                                            event
                                              .target
                                              .value,
                                          );

                                        if (
                                          event
                                            .target
                                            .value ===
                                          ""
                                        ) {
                                          return;
                                        }

                                        setCountItem.mutate(
                                          {
                                            itemId:
                                              item.id,
                                            value,
                                          },
                                        );
                                      }}
                                    />
                                  </div>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-3">
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Diferencia
                                    </p>

                                    <p
                                      className={cn(
                                        "mt-1 text-sm font-bold",
                                        difference >
                                          0 &&
                                          "text-emerald-600",
                                        difference <
                                          0 &&
                                          "text-destructive",
                                      )}
                                    >
                                      {item.counted_stock ===
                                      null
                                        ? "—"
                                        : difference >
                                            0
                                          ? `+${difference}`
                                          : difference}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                      Diferencia $
                                    </p>

                                    <p
                                      className={cn(
                                        "mt-1 text-sm font-bold",
                                        differenceValue >
                                          0 &&
                                          "text-emerald-600",
                                        differenceValue <
                                          0 &&
                                          "text-destructive",
                                      )}
                                    >
                                      {item.counted_stock ===
                                      null
                                        ? "—"
                                        : money(
                                            differenceValue,
                                          )}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          },
                        )}

                        {!filteredCountItems.length && (
                          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                            No hay productos.
                          </div>
                        )}
                      </div>

                      {/* PANTALLA GRANDE */}
                      <div className="hidden overflow-x-auto lg:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                Producto
                              </TableHead>

                              <TableHead className="text-right">
                                Teórico
                              </TableHead>

                              <TableHead className="text-right">
                                Físico
                              </TableHead>

                              <TableHead className="text-right">
                                Diferencia
                              </TableHead>

                              <TableHead className="text-right">
                                Diferencia $
                              </TableHead>

                              <TableHead>
                                Estado
                              </TableHead>
                            </TableRow>
                          </TableHeader>

                          <TableBody>
                            {filteredCountItems.map(
                              (item) => {
                                const counted =
                                  item.counted_stock;

                                const difference =
                                  Number(
                                    item.difference ??
                                      0,
                                  );

                                const differenceValue =
                                  Number(
                                    item.difference_value ??
                                      0,
                                  );

                                return (
                                  <TableRow
                                    key={item.id}
                                  >
                                    <TableCell className="font-medium">
                                      {item.products
                                        ?.name ??
                                        "Producto"}

                                      {item.products
                                        ?.sku && (
                                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                                          {
                                            item
                                              .products
                                              .sku
                                          }
                                        </span>
                                      )}

                                      {item.variant_id && (
                                        <Badge
                                          variant="outline"
                                          className="ml-2"
                                        >
                                          Variante
                                        </Badge>
                                      )}
                                    </TableCell>

                                    <TableCell className="text-right">
                                      {
                                        item.system_stock
                                      }
                                    </TableCell>

                                    <TableCell className="text-right">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="ml-auto h-8 w-28 text-right"
                                        value={
                                          physicalCount[
                                            item.id
                                          ] ??
                                          (counted !==
                                          null
                                            ? String(
                                                counted,
                                              )
                                            : "")
                                        }
                                        onChange={(
                                          event,
                                        ) => {
                                          const value =
                                            event
                                              .target
                                              .value;

                                          setPhysicalCount(
                                            (
                                              previous,
                                            ) => ({
                                              ...previous,
                                              [item.id]:
                                                value,
                                            }),
                                          );
                                        }}
                                        onBlur={(
                                          event,
                                        ) => {
                                          const value =
                                            Number(
                                              event
                                                .target
                                                .value,
                                            );

                                          if (
                                            event
                                              .target
                                              .value ===
                                            ""
                                          ) {
                                            return;
                                          }

                                          setCountItem.mutate(
                                            {
                                              itemId:
                                                item.id,
                                              value,
                                            },
                                          );
                                        }}
                                      />
                                    </TableCell>

                                    <TableCell
                                      className={cn(
                                        "text-right font-semibold",
                                        difference >
                                          0 &&
                                          "text-emerald-600",
                                        difference <
                                          0 &&
                                          "text-destructive",
                                      )}
                                    >
                                      {item.counted_stock ===
                                      null
                                        ? "—"
                                        : difference >
                                            0
                                          ? `+${difference}`
                                          : difference}
                                    </TableCell>

                                    <TableCell
                                      className={cn(
                                        "text-right font-semibold",
                                        differenceValue >
                                          0 &&
                                          "text-emerald-600",
                                        differenceValue <
                                          0 &&
                                          "text-destructive",
                                      )}
                                    >
                                      {item.counted_stock ===
                                      null
                                        ? "—"
                                        : money(
                                            differenceValue,
                                          )}
                                    </TableCell>

                                    <TableCell>
                                      {item.counted_stock ===
                                      null ? (
                                        <Badge variant="outline">
                                          Pendiente
                                        </Badge>
                                      ) : difference <
                                        0 ? (
                                        <Badge variant="destructive">
                                          Faltante
                                        </Badge>
                                      ) : difference >
                                        0 ? (
                                        <Badge variant="secondary">
                                          Sobrante
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary">
                                          Coincide
                                        </Badge>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              },
                            )}

                            {!filteredCountItems.length && (
                              <TableRow>
                                <TableCell
                                  colSpan={6}
                                  className="py-10 text-center text-muted-foreground"
                                >
                                  No hay productos.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* =====================================================
         * HISTORIAL FISICO
         * ===================================================== */}
        <TabsContent
          value="historial"
          className="mt-3 max-w-full overflow-x-hidden sm:mt-4"
        >
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-5 w-5 shrink-0" />
                Historial de inventarios físicos
              </CardTitle>
            </CardHeader>

            <CardContent className="px-3 sm:px-6">
              {countsLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Cargando historial...
                </div>
              ) : (
                <>
                  {/* CELULAR / TABLET */}
                  <div className="grid gap-2.5 lg:hidden">
                    {inventoryCounts.map(
                      (count) => (
                        <div
                          key={count.id}
                          className="rounded-xl border p-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Fecha
                              </p>

                              <p className="mt-1 text-sm font-semibold">
                                {shortDate(
                                  count.started_at,
                                )}
                              </p>
                            </div>

                            {count.status ===
                            "completed" ? (
                              <Badge
                                variant="secondary"
                                className="shrink-0 rounded-full"
                              >
                                Completado
                              </Badge>
                            ) : count.status ===
                              "counting" ? (
                              <Badge className="shrink-0 rounded-full">
                                En curso
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="shrink-0 rounded-full"
                              >
                                {count.status}
                              </Badge>
                            )}
                          </div>

                          <div className="mt-3 grid gap-2 border-t pt-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Notas
                              </p>

                              <p className="mt-1 break-words text-sm">
                                {count.notes ??
                                  "—"}
                              </p>
                            </div>

                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Finalizado
                              </p>

                              <p className="mt-1 text-sm">
                                {count.completed_at
                                  ? shortDate(
                                      count.completed_at,
                                    )
                                  : "—"}
                              </p>
                            </div>
                          </div>
                        </div>
                      ),
                    )}

                    {!inventoryCounts.length && (
                      <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                        Todavía no hay inventarios
                        físicos registrados.
                      </div>
                    )}
                  </div>

                  {/* PANTALLA GRANDE */}
                  <div className="hidden overflow-x-auto lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            Fecha
                          </TableHead>

                          <TableHead>
                            Estado
                          </TableHead>

                          <TableHead>
                            Notas
                          </TableHead>

                          <TableHead>
                            Finalizado
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {inventoryCounts.map(
                          (count) => (
                            <TableRow
                              key={count.id}
                            >
                              <TableCell className="whitespace-nowrap">
                                {shortDate(
                                  count.started_at,
                                )}
                              </TableCell>

                              <TableCell>
                                {count.status ===
                                "completed" ? (
                                  <Badge variant="secondary">
                                    Completado
                                  </Badge>
                                ) : count.status ===
                                  "counting" ? (
                                  <Badge>
                                    En curso
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">
                                    {count.status}
                                  </Badge>
                                )}
                              </TableCell>

                              <TableCell className="max-w-[280px] truncate">
                                {count.notes ??
                                  "—"}
                              </TableCell>

                              <TableCell>
                                {count.completed_at
                                  ? shortDate(
                                      count.completed_at,
                                    )
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ),
                        )}

                        {!inventoryCounts.length && (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="py-10 text-center text-muted-foreground"
                            >
                              Todavía no hay
                              inventarios físicos
                              registrados.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* =====================================================
         * MOVIMIENTOS
         * ===================================================== */}
        <TabsContent
          value="movimientos"
          className="mt-3 sm:mt-4"
        >
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">
                Historial de movimientos
              </CardTitle>
            </CardHeader>

            <CardContent className="px-3 sm:px-6">
              {/* CELULAR / TABLET */}
              <div className="grid gap-2.5 lg:hidden">
                {movements.map(
                  (movement) => {
                    const productName = (
                      movement.products as
                        | {
                            name?: string;
                          }
                        | null
                    )?.name ?? "—";

                    return (
                      <div
                        key={movement.id}
                        className="rounded-xl border p-3.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-bold">
                              {productName}
                            </p>

                            <p className="mt-1 text-xs text-muted-foreground">
                              {shortDate(
                                movement.created_at,
                              )}
                            </p>
                          </div>

                          <Badge
                            variant="outline"
                            className="shrink-0 rounded-full text-[10px]"
                          >
                            {MOVEMENT_LABELS[
                              movement.type
                            ] ??
                              movement.type}
                          </Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              Cantidad
                            </p>

                            <p className="mt-1 text-sm font-bold">
                              {Number(
                                movement.quantity,
                              ) > 0
                                ? `+${movement.quantity}`
                                : movement.quantity}
                            </p>
                          </div>

                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              Notas
                            </p>

                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {movement.notes ??
                                "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  },
                )}

                {!movements.length && (
                  <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                    Sin movimientos todavía.
                  </div>
                )}
              </div>

              {/* PANTALLA GRANDE */}
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        Fecha
                      </TableHead>

                      <TableHead>
                        Producto
                      </TableHead>

                      <TableHead>
                        Tipo
                      </TableHead>

                      <TableHead className="text-right">
                        Cantidad
                      </TableHead>

                      <TableHead>
                        Notas
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {movements.map(
                      (movement) => (
                        <TableRow
                          key={movement.id}
                        >
                          <TableCell className="whitespace-nowrap text-xs">
                            {shortDate(
                              movement.created_at,
                            )}
                          </TableCell>

                          <TableCell>
                            {(
                              movement.products as
                                | {
                                    name?: string;
                                  }
                                | null
                            )?.name ?? "—"}
                          </TableCell>

                          <TableCell>
                            <Badge variant="outline">
                              {MOVEMENT_LABELS[
                                movement.type
                              ] ??
                                movement.type}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right font-medium">
                            {Number(
                              movement.quantity,
                            ) > 0
                              ? `+${movement.quantity}`
                              : movement.quantity}
                          </TableCell>

                          <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                            {movement.notes ??
                              "—"}
                          </TableCell>
                        </TableRow>
                      ),
                    )}

                    {!movements.length && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-8 text-center text-muted-foreground"
                        >
                          Sin movimientos
                          todavía.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* =====================================================
         * REPOSICION
         * ===================================================== */}
        <TabsContent
          value="reposicion"
          className="mt-3 sm:mt-4"
        >
          <RestockList inventory={inventory} />
        </TabsContent>

        {/* =====================================================
         * IMPORTAR / EXPORTAR
         * ===================================================== */}
        <TabsContent
          value="importar"
          className="mt-3 sm:mt-4"
        >
          <ImportExportPanel />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function InventoryMetric({
  label,
  value,
  emphasis = false,
  danger = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p
        className={cn(
          "mt-1 break-words text-sm font-bold",
          emphasis && "text-base",
          danger && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CountKpi({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-3",
        danger &&
          "border-destructive/30 bg-destructive/5",
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>

      <p
        className={cn(
          "mt-1 break-words text-base font-bold sm:text-lg",
          danger && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}  