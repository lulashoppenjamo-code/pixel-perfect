import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CountItem = {
  id: string;
  count_id: string;
  product_id: string;
  variant_id: string | null;
  system_stock: number;
  physical_stock: number | null;
  difference: number | null;
  unit_cost: number;
  difference_value: number | null;
  counted_at: string | null;
  products:
    | {
        name: string;
        sku: string | null;
        barcode: string | null;
      }
    | null;
};

type Count = {
  id: string;
  branch_id: string;
  status: "open" | "completed" | "cancelled";
  notes: string | null;
  started_at: string;
  completed_at: string | null;
};

type Summary = {
  total_items: number;
  counted_items: number;
  pending_items: number;
  difference_items: number;
  shortage_units: number;
  surplus_units: number;
  shortage_value: number;
  surplus_value: number;
  net_difference_value: number;
};

export function SharedPhysicalInventoryPanel() {
  const { isManager } = useAuth();
  const { branchId } = useBranch();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [countId, setCountId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const countsQuery = useQuery({
    queryKey: ["shared-inventory-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_inventory_counts")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      return (data ?? []) as Count[];
    },
  });

  const activeCount = useMemo(
    () =>
      countsQuery.data?.find(
        (count) =>
          count.status === "open" &&
          (!countId || count.id === countId),
      ) ??
      countsQuery.data?.find(
        (count) => count.status === "open",
      ) ??
      null,
    [countsQuery.data, countId],
  );

  const selectedCountId = countId ?? activeCount?.id ?? null;

  const itemsQuery = useQuery({
    queryKey: ["shared-inventory-count-items", selectedCountId],
    enabled: Boolean(selectedCountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_inventory_count_items")
        .select(
          `
            id,
            count_id,
            product_id,
            variant_id,
            system_stock,
            physical_stock,
            difference,
            unit_cost,
            difference_value,
            counted_at,
            products (
              name,
              sku,
              barcode
            )
          `,
        )
        .eq("count_id", selectedCountId!)
        .order("product_id");

      if (error) throw error;

      return (data ?? []) as CountItem[];
    },
  });

  const summaryQuery = useQuery({
    queryKey: [
      "shared-inventory-count-summary",
      selectedCountId,
    ],
    enabled: Boolean(selectedCountId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_shared_inventory_count_summary",
        {
          _count_id: selectedCountId!,
        },
      );

      if (error) throw error;

      return (Array.isArray(data) ? data[0] : data) as
        | Summary
        | null;
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error(
          "No hay una sucursal activa seleccionada.",
        );
      }

      const { data, error } = await supabase.rpc(
        "start_shared_inventory_count",
        {
          _branch_id: branchId,
          _notes: notes.trim() || null,
        },
      );

      if (error) throw error;

      return data as string;
    },

    onSuccess: (id) => {
      setCountId(id);
      setNotes("");

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-counts"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-items"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-summary"],
      });

      toast.success("Inventario físico iniciado");
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      item,
      value,
    }: {
      item: CountItem;
      value: number;
    }) => {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          "La existencia física debe ser un número válido.",
        );
      }

      const { error } = await supabase.rpc(
        "set_shared_inventory_count_item",
        {
          _count_id: item.count_id,
          _product_id: item.product_id,
          _variant_id: item.variant_id,
          _physical_stock: value,
        },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-items",
          selectedCountId,
        ],
      });

      queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-summary",
          selectedCountId,
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCountId) {
        throw new Error(
          "No hay inventario físico seleccionado.",
        );
      }

      const { data, error } = await supabase.rpc(
        "complete_shared_inventory_count",
        {
          _count_id: selectedCountId,
        },
      );

      if (error) throw error;

      return Array.isArray(data) ? data[0] : data;
    },

    onSuccess: () => {
      toast.success(
        "Inventario físico completado y diferencias aplicadas.",
      );

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-counts"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-items"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-summary"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      queryClient.invalidateQueries({
        queryKey: ["inventory-movements"],
      });

      setCountId(null);
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCountId) {
        throw new Error(
          "No hay inventario físico seleccionado.",
        );
      }

      const { error } = await supabase.rpc(
        "cancel_shared_inventory_count",
        {
          _count_id: selectedCountId,
        },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Inventario físico cancelado.");

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-counts"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-items"],
      });

      queryClient.invalidateQueries({
        queryKey: ["shared-inventory-count-summary"],
      });

      setCountId(null);
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return itemsQuery.data ?? [];
    }

    return (itemsQuery.data ?? []).filter((item) => {
      const product = item.products;

      return (
        product?.name?.toLowerCase().includes(term) ||
        product?.sku?.toLowerCase().includes(term) ||
        product?.barcode?.toLowerCase().includes(term)
      );
    });
  }, [itemsQuery.data, search]);

  const summary = summaryQuery.data;

  const totalItems = Number(
    summary?.total_items ?? 0,
  );

  const countedItems = Number(
    summary?.counted_items ?? 0,
  );

  const pendingItems = Number(
    summary?.pending_items ?? 0,
  );

  const progress =
    totalItems > 0
      ? Math.round(
          (countedItems / totalItems) * 100,
        )
      : 0;

  const canComplete =
    Boolean(selectedCountId) &&
    Boolean(branchId) &&
    totalItems > 0 &&
    pendingItems === 0 &&
    !completeMutation.isPending;

  if (!isManager) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Solo un manager puede realizar inventarios físicos.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Inventario físico compartido
              </CardTitle>

              <p className="mt-1 text-sm text-muted-foreground">
                Cuenta las existencias reales sobre un único
                inventario central compartido por las dos
                sucursales.
              </p>
            </div>

            {!activeCount && (
              <Button
                disabled={
                  startMutation.isPending ||
                  !branchId
                }
                onClick={() =>
                  startMutation.mutate()
                }
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}

                Iniciar conteo
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!activeCount && (
            <div className="max-w-xl">
              <Input
                value={notes}
                onChange={(event) =>
                  setNotes(event.target.value)
                }
                placeholder="Notas del inventario (opcional)"
              />
            </div>
          )}

          {activeCount && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Productos
                    </div>

                    <div className="mt-1 text-2xl font-bold">
                      {totalItems}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Contados
                    </div>

                    <div className="mt-1 text-2xl font-bold">
                      {countedItems}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Pendientes
                    </div>

                    <div className="mt-1 text-2xl font-bold">
                      {pendingItems}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      Avance
                    </div>

                    <div className="mt-1 text-2xl font-bold">
                      {progress}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Progreso del inventario
                  </span>

                  <span>{progress}%</span>
                </div>

                <Progress value={progress} />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Buscar producto, SKU o código de barras..."
                  className="flex-1"
                />

                <Button
                  variant="outline"
                  disabled={
                    cancelMutation.isPending ||
                    completeMutation.isPending
                  }
                  onClick={() =>
                    cancelMutation.mutate()
                  }
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>

                <Button
                  disabled={!canComplete}
                  onClick={() =>
                    completeMutation.mutate()
                  }
                >
                  {completeMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}

                  Completar inventario
                </Button>
              </div>

              {!branchId && (
                <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Selecciona una sucursal antes de iniciar
                  un inventario físico.
                </div>
              )}

              {pendingItems > 0 && (
                <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />

                  Debes contar todos los productos antes
                  de completar el inventario.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selectedCountId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Conteo de productos
            </CardTitle>
          </CardHeader>

          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>

                  <TableHead>SKU</TableHead>

                  <TableHead className="text-right">
                    Sistema
                  </TableHead>

                  <TableHead className="text-right">
                    Físico
                  </TableHead>

                  <TableHead className="text-right">
                    Diferencia
                  </TableHead>

                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {items.map((item) => {
                  const difference =
                    item.physical_stock === null
                      ? null
                      : Number(
                          item.physical_stock,
                        ) -
                        Number(
                          item.system_stock,
                        );

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.products?.name ??
                          "Producto"}

                        {item.variant_id && (
                          <Badge
                            variant="outline"
                            className="ml-2"
                          >
                            Variante
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.products?.sku ?? "—"}
                      </TableCell>

                      <TableCell className="text-right font-semibold">
                        {Number(
                          item.system_stock,
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="ml-auto w-28 text-right"
                          disabled={
                            activeCount?.status !==
                              "open" ||
                            updateMutation.isPending
                          }
                          value={
                            item.physical_stock ===
                            null
                              ? ""
                              : item.physical_stock
                          }
                          onChange={(event) => {
                            const value =
                              event.target.value;

                            if (value === "") {
                              return;
                            }

                            const numericValue =
                              Number(value);

                            if (
                              !Number.isFinite(
                                numericValue,
                              ) ||
                              numericValue < 0
                            ) {
                              return;
                            }

                            updateMutation.mutate({
                              item,
                              value: numericValue,
                            });
                          }}
                        />
                      </TableCell>

                      <TableCell
                        className={
                          difference === null
                            ? "text-right"
                            : difference < 0
                              ? "text-right font-semibold text-destructive"
                              : difference > 0
                                ? "text-right font-semibold text-emerald-600"
                                : "text-right font-semibold"
                        }
                      >
                        {difference === null
                          ? "—"
                          : difference > 0
                            ? `+${difference}`
                            : difference}
                      </TableCell>

                      <TableCell>
                        {item.physical_stock ===
                        null ? (
                          <Badge variant="outline">
                            Pendiente
                          </Badge>
                        ) : difference === 0 ? (
                          <Badge variant="secondary">
                            Correcto
                          </Badge>
                        ) : difference < 0 ? (
                          <Badge variant="destructive">
                            Faltante
                          </Badge>
                        ) : (
                          <Badge>
                            Sobrante
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {!items.length && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No hay productos para mostrar.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selectedCountId && summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Faltantes
              </div>

              <div className="mt-1 text-xl font-bold text-destructive">
                {Number(
                  summary.shortage_units ?? 0,
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                $
                {Number(
                  summary.shortage_value ?? 0,
                ).toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Sobrantes
              </div>

              <div className="mt-1 text-xl font-bold text-emerald-600">
                {Number(
                  summary.surplus_units ?? 0,
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                $
                {Number(
                  summary.surplus_value ?? 0,
                ).toFixed(2)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">
                Diferencia neta
              </div>

              <div className="mt-1 text-xl font-bold">
                $
                {Number(
                  summary.net_difference_value ??
                    0,
                ).toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}