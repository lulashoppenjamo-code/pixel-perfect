import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  History,
  Play,
  Search,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getSharedInventory } from "@/lib/sharedInventory";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cn } from "@/lib/utils";

type CountSession = {
  id: string;
  branch_id: string;
  status: "open" | "completed" | "cancelled" | string;
  notes: string | null;
  started_by: string;
  completed_by: string | null;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
};

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
      }
    | null;
};

type CountSummary = {
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

function money(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function dateTime(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SharedPhysicalInventoryPanel() {
  const { isManager, profile } = useAuth();
  const queryClient = useQueryClient();

  const branchId = profile?.branch_id ?? null;

  const [search, setSearch] = useState("");
  const [physicalValues, setPhysicalValues] = useState<
    Record<string, string>
  >({});

  const [startNotes, setStartNotes] = useState("");

  const [showStartDialog, setShowStartDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  const {
    data: activeCount,
    isLoading: activeCountLoading,
  } = useQuery<CountSession | null>({
    queryKey: ["shared-inventory-active-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_inventory_counts")
        .select("*")
        .eq("status", "open")
        .order("started_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return data as CountSession | null;
    },
  });

  const {
    data: countItems = [],
    isLoading: itemsLoading,
  } = useQuery<CountItem[]>({
    queryKey: [
      "shared-inventory-count-items",
      activeCount?.id,
    ],
    enabled: Boolean(activeCount?.id),
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
            products(
              name,
              sku
            )
          `,
        )
        .eq("count_id", activeCount!.id)
        .order("id");

      if (error) throw error;

      return (data ?? []) as CountItem[];
    },
  });

  const {
    data: history = [],
  } = useQuery<CountSession[]>({
    queryKey: ["shared-inventory-count-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_inventory_counts")
        .select("*")
        .order("started_at", {
          ascending: false,
        })
        .limit(20);

      if (error) throw error;

      return (data ?? []) as CountSession[];
    },
  });

  const {
    data: summary,
  } = useQuery<CountSummary>({
    queryKey: [
      "shared-inventory-count-summary",
      activeCount?.id,
    ],
    enabled: Boolean(activeCount?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_shared_inventory_count_summary",
        {
          _count_id: activeCount!.id,
        },
      );

      if (error) throw error;

      const row = Array.isArray(data)
        ? data[0]
        : data;

      return {
        total_items: Number(row?.total_items ?? 0),
        counted_items: Number(row?.counted_items ?? 0),
        pending_items: Number(row?.pending_items ?? 0),
        difference_items: Number(
          row?.difference_items ?? 0,
        ),
        shortage_units: Number(
          row?.shortage_units ?? 0,
        ),
        surplus_units: Number(
          row?.surplus_units ?? 0,
        ),
        shortage_value: Number(
          row?.shortage_value ?? 0,
        ),
        surplus_value: Number(
          row?.surplus_value ?? 0,
        ),
        net_difference_value: Number(
          row?.net_difference_value ?? 0,
        ),
      };
    },
  });

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return countItems;

    return countItems.filter((item) => {
      const name =
        item.products?.name?.toLowerCase() ?? "";

      const sku =
        item.products?.sku?.toLowerCase() ?? "";

      return (
        name.includes(q) ||
        sku.includes(q)
      );
    });
  }, [countItems, search]);

  const startCount = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "Solo un manager puede iniciar un inventario físico.",
        );
      }

      if (!branchId) {
        throw new Error(
          "Tu usuario no tiene sucursal asignada.",
        );
      }

      const { data, error } =
        await supabase.rpc(
          "start_shared_inventory_count",
          {
            _branch_id: branchId,
            _notes:
              startNotes.trim() || null,
          },
        );

      if (error) throw error;

      return data as string;
    },

    onSuccess: () => {
      toast.success(
        "Inventario físico iniciado.",
      );

      setStartNotes("");
      setShowStartDialog(false);

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-active-count",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-history",
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const saveCountItem = useMutation({
    mutationFn: async ({
      item,
      value,
    }: {
      item: CountItem;
      value: string;
    }) => {
      const quantity = Number(value);

      if (
        !Number.isFinite(quantity) ||
        quantity < 0
      ) {
        throw new Error(
          "La cantidad física no es válida.",
        );
      }

      const { error } =
        await supabase.rpc(
          "set_shared_inventory_count_item",
          {
            _count_id: item.count_id,
            _product_id: item.product_id,
            _variant_id: item.variant_id,
            _physical_stock: quantity,
          },
        );

      if (error) throw error;
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-items",
          activeCount?.id,
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-summary",
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
      if (!activeCount?.id) {
        throw new Error(
          "No hay inventario físico abierto.",
        );
      }

      const { data, error } =
        await supabase.rpc(
          "complete_shared_inventory_count",
          {
            _count_id: activeCount.id,
          },
        );

      if (error) throw error;

      return Array.isArray(data)
        ? data[0]
        : data;
    },

    onSuccess: (result) => {
      toast.success(
        `Inventario completado. ${Number(
          result?.difference_items ?? 0,
        )} producto(s) con diferencia.`,
      );

      setPhysicalValues({});
      setShowCompleteDialog(false);

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-active-count",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-history",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "pos-products-shared",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "pos-variant-inventory-shared",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "inventory-movements",
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const cancelCount = useMutation({
    mutationFn: async () => {
      if (!activeCount?.id) {
        throw new Error(
          "No hay inventario físico abierto.",
        );
      }

      const { error } =
        await supabase.rpc(
          "cancel_shared_inventory_count",
          {
            _count_id: activeCount.id,
          },
        );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        "Inventario físico cancelado.",
      );

      setPhysicalValues({});
      setShowCancelDialog(false);

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-active-count",
        ],
      });

      void queryClient.invalidateQueries({
        queryKey: [
          "shared-inventory-count-history",
        ],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const progress = useMemo(() => {
    if (!summary?.total_items) return 0;

    return Math.round(
      (summary.counted_items /
        summary.total_items) *
        100,
    );
  }, [summary]);

  if (!isManager) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          El inventario físico profesional está
          disponible para managers.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ================================================= */}
      {/* CABECERA */}
      {/* ================================================= */}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-5 w-5" />
                Inventario físico
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Conteo profesional sobre el inventario
                compartido de ambas sucursales.
              </p>
            </div>

            {!activeCount && (
              <Button
                onClick={() =>
                  setShowStartDialog(true)
                }
                disabled={activeCountLoading}
              >
                <Play className="mr-2 h-4 w-4" />
                Iniciar inventario
              </Button>
            )}

            {activeCount && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Inventario abierto
                </Badge>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    setShowCancelDialog(true)
                  }
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>

                <Button
                  size="sm"
                  disabled={
                    !summary ||
                    summary.pending_items > 0 ||
                    completeCount.isPending
                  }
                  onClick={() =>
                    setShowCompleteDialog(true)
                  }
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {completeCount.isPending
                    ? "Completando..."
                    : "Completar inventario"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        {activeCount && summary && (
          <CardContent className="space-y-4">
            {/* PROGRESO */}

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>
                  Progreso
                </span>

                <strong>
                  {summary.counted_items} /{" "}
                  {summary.total_items}
                </strong>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                {progress}% completado
                {summary.pending_items > 0
                  ? ` · ${summary.pending_items} pendientes`
                  : " · Listo para cerrar"}
              </p>
            </div>

            {/* INDICADORES */}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Faltantes
                  </p>

                  <p className="mt-1 text-xl font-bold text-destructive">
                    {summary.shortage_units}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {money(
                      summary.shortage_value,
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Sobrantes
                  </p>

                  <p className="mt-1 text-xl font-bold text-emerald-600">
                    {summary.surplus_units}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {money(
                      summary.surplus_value,
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Diferencias
                  </p>

                  <p className="mt-1 text-xl font-bold">
                    {summary.difference_items}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    productos
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Diferencia neta
                  </p>

                  <p
                    className={cn(
                      "mt-1 text-xl font-bold",
                      summary.net_difference_value <
                        0
                        ? "text-destructive"
                        : "text-emerald-600",
                    )}
                  >
                    {money(
                      summary.net_difference_value,
                    )}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    valor a costo
                  </p>
                </CardContent>
              </Card>
            </div>

            {summary.pending_items > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />

                <div>
                  <strong>
                    Todavía no puedes completar el
                    inventario.
                  </strong>

                  <p className="text-xs text-muted-foreground">
                    Debes contar los{" "}
                    {summary.pending_items}{" "}
                    productos restantes.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ================================================= */}
      {/* CONTEO */}
      {/* ================================================= */}

      {activeCount && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">
                  Captura física
                </CardTitle>

                <p className="text-xs text-muted-foreground">
                  Iniciado:{" "}
                  {dateTime(
                    activeCount.started_at,
                  )}
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />

                <Input
                  className="pl-9"
                  placeholder="Buscar producto o SKU..."
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="overflow-x-auto">
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
                    Contado
                  </TableHead>

                  <TableHead className="text-right">
                    Diferencia
                  </TableHead>

                  <TableHead className="text-right">
                    Valor
                  </TableHead>

                  <TableHead className="text-right">
                    Acción
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {itemsLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center"
                    >
                      Cargando productos...
                    </TableCell>
                  </TableRow>
                )}

                {!itemsLoading &&
                  filteredItems.map((item) => {
                    const inputValue =
                      physicalValues[item.id] ??
                      (item.physical_stock ===
                      null
                        ? ""
                        : String(
                            item.physical_stock,
                          ));

                    const currentPhysical =
                      inputValue === ""
                        ? null
                        : Number(
                            inputValue,
                          );

                    const difference =
                      currentPhysical ===
                        null ||
                      !Number.isFinite(
                        currentPhysical,
                      )
                        ? item.difference
                        : currentPhysical -
                          Number(
                            item.system_stock,
                          );

                    const differenceValue =
                      difference === null
                        ? item.difference_value
                        : difference *
                          Number(
                            item.unit_cost,
                          );

                    return (
                      <TableRow
                        key={item.id}
                      >
                        <TableCell>
                          <div className="font-medium">
                            {item.products
                              ?.name ??
                              "Producto"}
                          </div>

                          {item.products
                            ?.sku && (
                            <div className="font-mono text-xs text-muted-foreground">
                              {
                                item.products
                                  .sku
                              }
                            </div>
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
                            className="ml-auto h-9 w-28 text-right"
                            value={
                              inputValue
                            }
                            onChange={(
                              event,
                            ) =>
                              setPhysicalValues(
                                (
                                  previous,
                                ) => ({
                                  ...previous,
                                  [item.id]:
                                    event
                                      .target
                                      .value,
                                }),
                              )
                            }
                          />
                        </TableCell>

                        <TableCell
                          className={cn(
                            "text-right font-semibold",
                            difference !==
                              null &&
                              difference >
                                0 &&
                              "text-emerald-600",
                            difference !==
                              null &&
                              difference <
                                0 &&
                              "text-destructive",
                          )}
                        >
                          {difference ===
                          null
                            ? "—"
                            : difference > 0
                              ? `+${difference}`
                              : difference}
                        </TableCell>

                        <TableCell
                          className={cn(
                            "text-right",
                            differenceValue !==
                              null &&
                              differenceValue <
                                0 &&
                              "text-destructive",
                            differenceValue !==
                              null &&
                              differenceValue >
                                0 &&
                              "text-emerald-600",
                          )}
                        >
                          {differenceValue ===
                          null
                            ? "—"
                            : money(
                                Number(
                                  differenceValue,
                                ),
                              )}
                        </TableCell>

                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              inputValue ===
                                "" ||
                              saveCountItem.isPending
                            }
                            onClick={() => {
                              saveCountItem.mutate({
                                item,
                                value:
                                  inputValue,
                              });
                            }}
                          >
                            Guardar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                {!itemsLoading &&
                  filteredItems.length ===
                    0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No hay productos que
                        coincidan.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ================================================= */}
      {/* HISTORIAL */}
      {/* ================================================= */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Historial de inventarios físicos
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
                  Estado
                </TableHead>

                <TableHead>
                  Notas
                </TableHead>

                <TableHead>
                  Inicio
                </TableHead>

                <TableHead>
                  Finalización
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {history.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {dateTime(
                      item.started_at,
                    )}
                  </TableCell>

                  <TableCell>
                    {item.status ===
                    "completed" ? (
                      <Badge>
                        Completado
                      </Badge>
                    ) : item.status ===
                      "cancelled" ? (
                      <Badge variant="outline">
                        Cancelado
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        Abierto
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[240px] truncate">
                    {item.notes || "—"}
                  </TableCell>

                  <TableCell className="text-xs">
                    {dateTime(
                      item.started_at,
                    )}
                  </TableCell>

                  <TableCell className="text-xs">
                    {dateTime(
                      item.completed_at,
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {!history.length && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Todavía no hay inventarios
                    físicos registrados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ================================================= */}
      {/* DIALOG INICIAR */}
      {/* ================================================= */}

      <Dialog
        open={showStartDialog}
        onOpenChange={
          setShowStartDialog
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Iniciar inventario físico
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label>
              Nota / referencia
            </Label>

            <Textarea
              value={startNotes}
              onChange={(event) =>
                setStartNotes(
                  event.target.value,
                )
              }
              placeholder="Ej. Inventario mensual septiembre 2026"
            />

            <p className="text-xs text-muted-foreground">
              El sistema tomará una fotografía del
              stock compartido actual. Ambas
              sucursales trabajan sobre esa misma
              existencia.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setShowStartDialog(false)
              }
            >
              Cancelar
            </Button>

            <Button
              disabled={
                startCount.isPending
              }
              onClick={() =>
                startCount.mutate()
              }
            >
              {startCount.isPending
                ? "Iniciando..."
                : "Iniciar conteo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================= */}
      {/* DIALOG CANCELAR */}
      {/* ================================================= */}

      <Dialog
        open={showCancelDialog}
        onOpenChange={
          setShowCancelDialog
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancelar inventario
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            El conteo será cancelado y no se
            modificará el inventario compartido.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setShowCancelDialog(false)
              }
            >
              Volver
            </Button>

            <Button
              variant="destructive"
              disabled={
                cancelCount.isPending
              }
              onClick={() =>
                cancelCount.mutate()
              }
            >
              {cancelCount.isPending
                ? "Cancelando..."
                : "Sí, cancelar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================= */}
      {/* DIALOG COMPLETAR */}
      {/* ================================================= */}

      <Dialog
        open={showCompleteDialog}
        onOpenChange={
          setShowCompleteDialog
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Completar inventario físico
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm">
              Al completar:
            </p>

            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Se aplicarán las diferencias al
                inventario compartido.
              </li>

              <li>
                Los faltantes quedarán registrados
                como salida.
              </li>

              <li>
                Los sobrantes quedarán registrados
                como entrada.
              </li>

              <li>
                Se conservará el valor económico de
                las diferencias.
              </li>
            </ul>

            {summary && (
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between">
                  <span>Faltante:</span>
                  <strong className="text-destructive">
                    {money(
                      summary.shortage_value,
                    )}
                  </strong>
                </div>

                <div className="flex justify-between">
                  <span>Sobrante:</span>
                  <strong className="text-emerald-600">
                    {money(
                      summary.surplus_value,
                    )}
                  </strong>
                </div>

                <div className="mt-2 flex justify-between border-t pt-2">
                  <span>Neto:</span>
                  <strong>
                    {money(
                      summary.net_difference_value,
                    )}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setShowCompleteDialog(
                  false,
                )
              }
            >
              Volver
            </Button>

            <Button
              disabled={
                completeCount.isPending
              }
              onClick={() =>
                completeCount.mutate()
              }
            >
              {completeCount.isPending
                ? "Aplicando..."
                : "Completar y ajustar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}