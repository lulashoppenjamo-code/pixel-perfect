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
  const { isManager, profile } = useAuth();
  const queryClient = useQueryClient();

  const branchId = profile?.branch_id ?? null;

  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustDirection, setAdjustDirection] =
    useState<"in" | "out">("in");

  const [limitProduct, setLimitProduct] = useState("");
  const [limitMin, setLimitMin] = useState("0");
  const [limitMax, setLimitMax] = useState("");

  const [countFilter, setCountFilter] = useState("");
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
          "Tu usuario no tiene una sucursal asignada.",
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
          "Tu usuario no tiene una sucursal asignada.",
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
              className="gap-1"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {lowStock.length} bajo mínimo
            </Badge>
          ) : undefined
        }
      />

      {inventoryError && (
        <Card className="border-destructive/30">
          <CardContent className="pt-6 text-sm text-destructive">
            Error al cargar inventario:{" "}
            {(inventoryError as Error).message}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="existencias">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="existencias">
            Existencias
          </TabsTrigger>

          <TabsTrigger value="ajuste">
            Ajuste
          </TabsTrigger>

          <TabsTrigger value="limites">
            Límites
          </TabsTrigger>

          <TabsTrigger value="conteo">
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            Inventario físico
          </TabsTrigger>

          <TabsTrigger value="historial">
            <History className="mr-1 h-3.5 w-3.5" />
            Historial físico
          </TabsTrigger>

          <TabsTrigger value="movimientos">
            Movimientos
          </TabsTrigger>

          <TabsTrigger value="reposicion">
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            Reposición
          </TabsTrigger>

          <TabsTrigger value="importar">
            <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
            Importar / Exportar
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="existencias"
          className="mt-4"
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Existencias compartidas
              </CardTitle>

              <p className="text-xs text-muted-foreground">
                Una sola existencia para ambas sucursales.
              </p>
            </CardHeader>

            <CardContent className="px-0 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Producto
                    </TableHead>

                    <TableHead className="hidden sm:table-cell">
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

                    <TableHead className="hidden text-right sm:table-cell">
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

                  {inventory.map(
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

                          <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
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

                          <TableCell className="hidden text-right sm:table-cell">
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="ajuste"
          className="mt-4"
        >
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Ajuste directo
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
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
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>

                  <SelectContent>
                    {productOptions}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                    <SelectTrigger>
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
                />
              </div>

              <Button
                className="w-full"
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

        <TabsContent
          value="limites"
          className="mt-4"
        >
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Mínimo / máximo
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
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
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>

                  <SelectContent>
                    {productOptions}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  />
                </div>
              </div>

              <Button
                className="w-full"
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

        <TabsContent
          value="conteo"
          className="mt-4"
        >
          {!activeCount ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-5 w-5" />
                  Nuevo inventario físico
                </CardTitle>
              </CardHeader>

              <CardContent className="max-w-xl space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <p className="font-medium">
                    Antes de comenzar
                  </p>

                  <p className="mt-1 text-muted-foreground">
                    Lula OS tomará una fotografía
                    del stock teórico actual y
                    después podrás capturar las
                    existencias físicas.
                  </p>

                  <p className="mt-2 text-muted-foreground">
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
                  />
                </div>

                <Button
                  className="w-full"
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
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ClipboardList className="h-5 w-5" />
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
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
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

                    <div className="rounded-lg border p-3">
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
                    <div>
                      <CardTitle className="text-base">
                        Captura física
                      </CardTitle>

                      <p className="text-xs text-muted-foreground">
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
                      className="w-full sm:w-64"
                    />
                  </div>
                </CardHeader>

                <CardContent className="overflow-x-auto">
                  {activeCountItemsLoading ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      Cargando productos...
                    </div>
                  ) : (
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
                                        item.products
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
                                        event.target
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
                                          event.target
                                            .value,
                                        );

                                      if (
                                        event.target
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
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="historial"
          className="mt-4"
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-5 w-5" />
                Historial de inventarios físicos
              </CardTitle>
            </CardHeader>

            <CardContent className="overflow-x-auto">
              {countsLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Cargando historial...
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="movimientos"
          className="mt-4"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Historial de movimientos
              </CardTitle>
            </CardHeader>

            <CardContent className="overflow-x-auto">
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="reposicion"
          className="mt-4"
        >
          <RestockList />
        </TabsContent>

        <TabsContent
          value="importar"
          className="mt-4"
        >
          <ImportExportPanel />
        </TabsContent>
      </Tabs>
    </PageShell>
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
        "rounded-lg border p-3",
        danger &&
          "border-destructive/30 bg-destructive/5",
      )}
    >
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p
        className={cn(
          "text-lg font-bold",
          danger && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}