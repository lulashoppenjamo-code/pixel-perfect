import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ClipboardList,
  Package,
  FileSpreadsheet,
  Boxes,
} from "lucide-react";
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

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario — Lula OS" },
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

type SharedRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  cost: number;
  image_url: string | null;
  emoji: string | null;
  is_active: boolean;
  stock: number;
  reserved_stock: number;
  available_stock: number;
  min_stock: number;
  max_stock: number | null;
  stock_status: string;
};

const MOV_LABEL: Record<string, string> = {
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
  const qc = useQueryClient();

  const [adjProduct, setAdjProduct] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjDir, setAdjDir] = useState<"in" | "out">("in");

  const [limProduct, setLimProduct] = useState("");
  const [limMin, setLimMin] = useState("0");
  const [limMax, setLimMax] = useState("");

  const [countMap, setCountMap] = useState<Record<string, string>>({});
  const [countFilter, setCountFilter] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
    void qc.invalidateQueries({ queryKey: ["pos-products-shared"] });
    void qc.invalidateQueries({
      queryKey: ["pos-variant-inventory-shared"],
    });
    void qc.invalidateQueries({
      queryKey: ["inventory-movements"],
    });
  };

  const {
    data: rows = [],
    isLoading,
    error: inventoryError,
  } = useQuery({
    queryKey: ["shared-inventory"],
    queryFn: getSharedInventory,
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "id, type, quantity, notes, created_at, products(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["inv-products-shared"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
  });

  const lowStock = useMemo(
    () =>
      rows.filter(
        (r) =>
          Number(r.available_stock) <= Number(r.min_stock),
      ),
    [rows],
  );

  const countRows = useMemo(() => {
    const q = countFilter.trim().toLowerCase();

    if (!q) return rows;

    return rows.filter((r) => {
      return (
        r.product_name.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        (r.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, countFilter]);

  const adjust = useMutation({
    mutationFn: async () => {
      if (!adjProduct) {
        throw new Error("Selecciona un producto");
      }

      const quantity = Math.abs(Number(adjQty));

      if (!quantity || quantity <= 0) {
        throw new Error("Cantidad inválida");
      }

      const signed =
        adjDir === "in" ? quantity : -quantity;

      const { error } = await supabase.rpc("adjust_stock", {
        _branch_id: null,
        _product_id: adjProduct,
        _variant_id: null,
        _quantity: signed,
        _notes:
          adjNotes ||
          (adjDir === "in"
            ? "Ajuste entrada"
            : "Ajuste salida"),
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventario compartido ajustado");
      setAdjQty("");
      setAdjNotes("");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const setLimits = useMutation({
    mutationFn: async () => {
      if (!limProduct) {
        throw new Error("Selecciona un producto");
      }

      const min = Number(limMin);

      if (Number.isNaN(min) || min < 0) {
        throw new Error("Mínimo inválido");
      }

      const max =
        limMax.trim() === ""
          ? null
          : Number(limMax);

      if (
        max !== null &&
        (Number.isNaN(max) || max < 0)
      ) {
        throw new Error("Máximo inválido");
      }

      await setSharedInventoryLimits(
        limProduct,
        null,
        min,
        max,
      );
    },
    onSuccess: () => {
      toast.success("Límites actualizados");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const applyCount = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error("Sin permisos");
      }

      const diffs: {
        product_id: string;
        delta: number;
        name: string;
      }[] = [];

      for (const row of rows) {
        if (row.variant_id) continue;

        const raw = countMap[row.product_id];

        if (raw === undefined || raw === "") {
          continue;
        }

        const counted = Number(raw);

        if (Number.isNaN(counted) || counted < 0) {
          continue;
        }

        const delta =
          counted - Number(row.stock);

        if (delta === 0) continue;

        diffs.push({
          product_id: row.product_id,
          delta,
          name: row.product_name,
        });
      }

      if (!diffs.length) {
        throw new Error(
          "No hay diferencias para aplicar",
        );
      }

      for (const diff of diffs) {
        const { error } = await supabase.rpc(
          "adjust_stock",
          {
            _branch_id: null,
            _product_id: diff.product_id,
            _variant_id: null,
            _quantity: diff.delta,
            _notes: `Conteo físico (${
              diff.delta > 0 ? "+" : ""
            }${diff.delta})`,
          },
        );

        if (error) {
          throw new Error(
            `${diff.name}: ${error.message}`,
          );
        }
      }

      return diffs.length;
    },
    onSuccess: (total) => {
      toast.success(
        `Conteo aplicado: ${total} producto(s)`,
      );
      setCountMap({});
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const productOptions = products.map((product) => (
    <SelectItem
      key={product.id}
      value={product.id}
    >
      {product.name}
      {product.sku ? ` (${product.sku})` : ""}
    </SelectItem>
  ));

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
              className="w-fit gap-1"
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
                El stock mostrado es único para las dos
                sucursales.
              </p>
            </CardHeader>

            <CardContent className="px-0 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
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
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-10 text-center text-muted-foreground"
                      >
                        Cargando...
                      </TableCell>
                    </TableRow>
                  )}

                  {!isLoading &&
                    rows.length === 0 && (
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

                  {rows.map((row) => {
                    const low =
                      Number(row.available_stock) <=
                      Number(row.min_stock);

                    return (
                      <TableRow
                        key={`${row.product_id}-${row.variant_id ?? "base"}`}
                        className={cn(
                          low && "bg-destructive/5",
                        )}
                      >
                        <TableCell className="max-w-[12rem] truncate font-medium sm:max-w-none">
                          <span className="mr-1.5">
                            {row.emoji ?? "📦"}
                          </span>

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
                          {Number(row.reserved_stock)}
                        </TableCell>

                        <TableCell className="text-right font-semibold">
                          {Number(row.available_stock)}
                        </TableCell>

                        <TableCell className="hidden text-right sm:table-cell">
                          {Number(row.min_stock)}
                        </TableCell>

                        <TableCell className="text-right">
                          {low ? (
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
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ajuste" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Ajuste de inventario compartido
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Producto</Label>

                <Select
                  value={adjProduct}
                  onValueChange={setAdjProduct}
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
                  <Label>Dirección</Label>

                  <Select
                    value={adjDir}
                    onValueChange={(value) =>
                      setAdjDir(
                        value as "in" | "out",
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
                  <Label>Cantidad</Label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adjQty}
                    onChange={(event) =>
                      setAdjQty(event.target.value)
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Motivo</Label>

                <Input
                  value={adjNotes}
                  onChange={(event) =>
                    setAdjNotes(event.target.value)
                  }
                  placeholder="Merma, daño, conteo..."
                />
              </div>

              <Button
                className="w-full"
                disabled={
                  !isManager ||
                  !adjProduct ||
                  !adjQty ||
                  adjust.isPending
                }
                onClick={() => adjust.mutate()}
              >
                {adjust.isPending
                  ? "Aplicando..."
                  : "Aplicar ajuste"}
              </Button>

              {!isManager && (
                <p className="text-xs text-muted-foreground">
                  Solo managers pueden ajustar stock.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limites" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">
                Mínimo / máximo
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Producto</Label>

                <Select
                  value={limProduct}
                  onValueChange={setLimProduct}
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
                  <Label>Mínimo</Label>

                  <Input
                    type="number"
                    min="0"
                    value={limMin}
                    onChange={(event) =>
                      setLimMin(event.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Máximo (vacío = sin límite)
                  </Label>

                  <Input
                    type="number"
                    min="0"
                    value={limMax}
                    onChange={(event) =>
                      setLimMax(event.target.value)
                    }
                  />
                </div>
              </div>

              <Button
                className="w-full"
                disabled={
                  !isManager ||
                  !limProduct ||
                  setLimits.isPending
                }
                onClick={() => setLimits.mutate()}
              >
                {setLimits.isPending
                  ? "Guardando..."
                  : "Guardar límites"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conteo" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">
                    Conteo físico
                  </CardTitle>

                  <p className="text-xs text-muted-foreground">
                    Cuenta físicamente el inventario
                    compartido y aplica las diferencias.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Producto / SKU / código..."
                    value={countFilter}
                    onChange={(event) =>
                      setCountFilter(event.target.value)
                    }
                    className="w-full sm:w-56"
                  />

                  <Button
                    disabled={
                      !isManager ||
                      applyCount.isPending
                    }
                    onClick={() =>
                      applyCount.mutate()
                    }
                  >
                    {applyCount.isPending
                      ? "Aplicando..."
                      : "Aplicar"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">
                      Teórico
                    </TableHead>
                    <TableHead className="text-right">
                      Contado
                    </TableHead>
                    <TableHead className="text-right">
                      Diferencia
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {countRows
                    .filter((row) => !row.variant_id)
                    .map((row) => {
                      const theoretical =
                        Number(row.stock);

                      const raw =
                        countMap[row.product_id];

                      const counted =
                        raw === undefined ||
                        raw === ""
                          ? null
                          : Number(raw);

                      const difference =
                        counted === null ||
                        Number.isNaN(counted)
                          ? null
                          : counted - theoretical;

                      return (
                        <TableRow
                          key={row.id}
                        >
                          <TableCell className="font-medium">
                            {row.emoji ?? "📦"}{" "}
                            {row.product_name}

                            {row.sku && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {row.sku}
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            {theoretical}
                          </TableCell>

                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="ml-auto h-8 w-28 text-right"
                              value={raw ?? ""}
                              onChange={(event) =>
                                setCountMap(
                                  (previous) => ({
                                    ...previous,
                                    [row.product_id]:
                                      event.target.value,
                                  }),
                                )
                              }
                              placeholder="—"
                            />
                          </TableCell>

                          <TableCell
                            className={cn(
                              "text-right font-medium",
                              difference !== null &&
                                difference > 0 &&
                                "text-emerald-600",
                              difference !== null &&
                                difference < 0 &&
                                "text-destructive",
                            )}
                          >
                            {difference === null
                              ? "—"
                              : difference > 0
                                ? `+${difference}`
                                : difference}
                          </TableCell>
                        </TableRow>
                      );
                    })}

                  {!countRows.length && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No hay productos para contar.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">
                      Cantidad
                    </TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {movements.map((movement) => (
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
                          movement.products as {
                            name?: string;
                          } | null
                        )?.name ?? "—"}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline">
                          {MOV_LABEL[
                            movement.type
                          ] ?? movement.type}
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
                        {movement.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}

                  {!movements.length && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Sin movimientos todavía.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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