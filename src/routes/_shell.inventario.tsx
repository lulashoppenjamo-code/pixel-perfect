import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ClipboardList,
  FileSpreadsheet,
  Boxes,
  Package,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  getSharedInventory,
  setSharedInventoryLimits,
} from "@/lib/sharedInventory";
import { shortDate } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { PageHeader, PageShell } from "@/components/PageHeader";

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

import { SharedPhysicalInventoryPanel } from "@/components/inventory/SharedPhysicalInventoryPanel";

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

  /*
   * ============================================================
   * INVENTARIO COMPARTIDO
   * ============================================================
   *
   * IMPORTANTE:
   *
   * El inventario es GLOBAL para las dos sucursales.
   *
   * branchId NO divide el stock.
   *
   * Únicamente identifica la sucursal desde donde
   * se realizó una operación para efectos de auditoría.
   */

  const branchId = profile?.branch_id ?? null;

  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");

  const [adjustDirection, setAdjustDirection] =
    useState<"in" | "out">("in");

  const [limitProduct, setLimitProduct] = useState("");
  const [limitMin, setLimitMin] = useState("0");
  const [limitMax, setLimitMax] = useState("");

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
      queryKey: ["shared-inventory-counts"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["shared-inventory-count-items"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["shared-inventory-count-summary"],
    });
  };

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   * ============================================================
   */

  const {
    data: inventory = [],
    isLoading: inventoryLoading,
    error: inventoryError,
  } = useQuery({
    queryKey: ["shared-inventory"],
    queryFn: getSharedInventory,
  });

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const { data: products = [] } = useQuery({
    queryKey: ["inv-products-shared"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode")
        .eq("is_active", true)
        .order("name");

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  /*
   * ============================================================
   * MOVIMIENTOS
   * ============================================================
   */

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "id, type, quantity, notes, created_at, products(name)",
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

  /*
   * ============================================================
   * PRODUCTOS BAJO MÍNIMO
   * ============================================================
   */

  const lowStock = useMemo(() => {
    return inventory.filter(
      (row) =>
        Number(row.available_stock) <=
        Number(row.min_stock),
    );
  }, [inventory]);

  /*
   * ============================================================
   * AJUSTE DE INVENTARIO
   * ============================================================
   */

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

  /*
   * ============================================================
   * MÍNIMOS Y MÁXIMOS
   * ============================================================
   */

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
        (!Number.isFinite(max) || max < 0)
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
        "Límites de inventario actualizados.",
      );

      invalidateInventory();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  /*
   * ============================================================
   * OPCIONES DE PRODUCTOS
   * ============================================================
   */

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
            Conteo físico
          </TabsTrigger>

          <TabsTrigger value="movimientos">
            Movimientos
          </TabsTrigger>

          <TabsTrigger value="importar">
            <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
            Importar / Exportar
          </TabsTrigger>
        </TabsList>

        {/* ================================================== */}
        {/* EXISTENCIAS                                       */}
        {/* ================================================== */}

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
                Las ventas, compras, devoluciones y ajustes
                modifican este mismo stock.
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
                      const isLow =
                        Number(
                          row.available_stock,
                        ) <=
                        Number(
                          row.min_stock,
                        );

                      const isOut =
                        Number(
                          row.available_stock,
                        ) <= 0;

                      return (
                        <TableRow
                          key={`${row.product_id}-${
                            row.variant_id ??
                            "base"
                          }`}
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
                            {Number(
                              row.available_stock,
                            )}
                          </TableCell>

                          <TableCell className="hidden text-right sm:table-cell">
                            {Number(
                              row.min_stock,
                            )}
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

        {/* ================================================== */}
        {/* AJUSTE                                            */}
        {/* ================================================== */}

        <TabsContent
          value="ajuste"
          className="mt-4"
        >
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Ajuste de inventario compartido
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
                    value={
                      adjustDirection
                    }
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
                    value={
                      adjustQuantity
                    }
                    onChange={(event) =>
                      setAdjustQuantity(
                        event.target
                          .value,
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

              {!isManager && (
                <p className="text-xs text-muted-foreground">
                  Solo managers pueden ajustar
                  stock.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================== */}
        {/* LIMITES                                            */}
        {/* ================================================== */}

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

        {/* ================================================== */}
        {/* CONTEO FÍSICO — NUEVO INVENTARIO COMPARTIDO       */}
        {/* ================================================== */}

        <TabsContent
          value="conteo"
          className="mt-4"
        >
          <SharedPhysicalInventoryPanel />
        </TabsContent>

        {/* ================================================== */}
        {/* MOVIMIENTOS                                        */}
        {/* ================================================== */}

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

        {/* ================================================== */}
        {/* IMPORTAR / EXPORTAR                               */}
        {/* ================================================== */}

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