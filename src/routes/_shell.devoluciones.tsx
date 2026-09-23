import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  RotateCcw,
  RefreshCw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import {
  getSharedInventory,
} from "@/lib/sharedInventory";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute(
  "/_shell/devoluciones",
)({
  head: () => ({
    meta: [
      {
        title:
          "Devoluciones — Lula OS",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="devoluciones">
      <DevolucionesPage />
    </RequireNavAccess>
  ),
});

type SaleRow = {
  id: string;
  folio: number;
  total: number;
  status: string;
  created_at: string;
  payment_method: string;
};

type SaleItem = {
  id: string;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  discount: number;
  total: number;
  product_id: string | null;
};

function DevolucionesPage() {
  const { branchId } = useBranch();

  const qc = useQueryClient();

  const [folioSearch, setFolioSearch] =
    useState("");

  const [selectedSaleId, setSelectedSaleId] =
    useState<string | null>(null);

  const [selectedItems, setSelectedItems] =
    useState<Record<string, number>>({});

  const [reason, setReason] =
    useState("");

  const [dialogOpen, setDialogOpen] =
    useState(false);

  /*
   * ============================================================
   * VENTAS
   * ============================================================
   */

  const {
    data: recentSales = [],
    isLoading,
  } = useQuery<SaleRow[]>({
    queryKey: [
      "recent-sales-refund",
      branchId,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sales")
          .select(
            `
              id,
              folio,
              total,
              status,
              created_at,
              payment_method
            `,
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .in(
            "status",
            [
              "completed",
              "partially_refunded",
            ],
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          )
          .limit(100);

      if (error) {
        throw error;
      }

      return (data ??
        []) as SaleRow[];
    },
  });

  const filteredSales =
    folioSearch.trim()
      ? recentSales.filter(
          (sale) =>
            String(
              sale.folio,
            ).includes(
              folioSearch.trim(),
            ),
        )
      : recentSales;

  /*
   * ============================================================
   * EXISTENCIA CENTRAL
   *
   * Se refresca después de una devolución.
   * ============================================================
   */

  const {
    data: sharedInventory = [],
  } = useQuery({
    queryKey: [
      "shared-inventory",
      "devoluciones",
    ],

    queryFn: getSharedInventory,
  });

  /*
   * ============================================================
   * PARTIDAS DE LA VENTA
   * ============================================================
   */

  const {
    data: saleItems = [],
    isLoading: loadingItems,
  } = useQuery<SaleItem[]>({
    queryKey: [
      "sale-items-refund",
      selectedSaleId,
    ],

    enabled: !!selectedSaleId,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("sale_items")
          .select(
            `
              id,
              name_snapshot,
              unit_price,
              quantity,
              discount,
              total,
              product_id
            `,
          )
          .eq(
            "sale_id",
            selectedSaleId!,
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as SaleItem[];
    },
  });

  /*
   * ============================================================
   * ABRIR DEVOLUCIÓN
   * ============================================================
   */

  const openRefund = (
    saleId: string,
  ) => {
    setSelectedSaleId(saleId);
    setSelectedItems({});
    setReason("");
    setDialogOpen(true);
  };

  /*
   * ============================================================
   * SELECCIONAR PRODUCTO
   * ============================================================
   */

  const toggleItem = (
    item: SaleItem,
    checked: boolean,
  ) => {
    setSelectedItems(
      (previous) => {
        const next = {
          ...previous,
        };

        if (checked) {
          next[item.id] =
            Number(item.quantity);
        } else {
          delete next[item.id];
        }

        return next;
      },
    );
  };

  /*
   * ============================================================
   * CANTIDAD A DEVOLVER
   * ============================================================
   */

  const setRefundQty = (
    itemId: string,
    quantity: number,
    max: number,
  ) => {
    const value = Math.min(
      Math.max(
        1,
        Number.isFinite(quantity)
          ? quantity
          : 1,
      ),
      max,
    );

    setSelectedItems(
      (previous) => ({
        ...previous,
        [itemId]: value,
      }),
    );
  };

  /*
   * ============================================================
   * DEVOLVER
   *
   * La RPC refund_sale es la operación transaccional.
   *
   * El frontend NO modifica inventory directamente.
   * ============================================================
   */

  const refund = useMutation({
    mutationFn: async () => {
      if (!selectedSaleId) {
        throw new Error(
          "No hay una venta seleccionada",
        );
      }

      const items = Object.entries(
        selectedItems,
      ).map(
        ([
          sale_item_id,
          quantity,
        ]) => ({
          sale_item_id,
          quantity,
        }),
      );

      if (!items.length) {
        throw new Error(
          "Selecciona al menos un producto",
        );
      }

      const { data, error } =
        await supabase.rpc(
          "refund_sale",
          {
            _sale_id:
              selectedSaleId,

            _items: items,

            ...(reason.trim()
              ? {
                  _reason:
                    reason.trim(),
                }
              : {}),
          },
        );

      if (error) {
        throw error;
      }

      return data;
    },

    onSuccess: async () => {
      toast.success(
        "Devolución registrada y existencia restaurada.",
      );

      setDialogOpen(false);
      setSelectedSaleId(null);
      setSelectedItems({});
      setReason("");

      await Promise.all([
        qc.invalidateQueries({
          queryKey: [
            "recent-sales-refund",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "sale-items-refund",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "shared-inventory",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "pos-products-shared",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "pos-variant-inventory-shared",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "inventory",
          ],
        }),
      ]);
    },

    onError: (
      error: Error,
    ) => {
      toast.error(
        error.message ||
          "No se pudo registrar la devolución",
      );
    },
  });

  /*
   * ============================================================
   * ESTADO
   * ============================================================
   */

  const statusBadge = (
    status: string,
  ) => {
    const variants: Record<
      string,
      | "default"
      | "secondary"
      | "destructive"
      | "outline"
    > = {
      completed: "default",
      partially_refunded:
        "secondary",
      refunded: "outline",
      cancelled:
        "destructive",
    };

    const labels: Record<
      string,
      string
    > = {
      completed: "Completada",
      partially_refunded:
        "Parcial",
      refunded:
        "Devuelta",
      cancelled:
        "Cancelada",
    };

    return (
      <Badge
        variant={
          variants[status] ??
          "outline"
        }
      >
        {labels[status] ??
          status}
      </Badge>
    );
  };

  /*
   * ============================================================
   * TOTAL DE DEVOLUCIÓN
   * ============================================================
   */

  const refundTotal =
    saleItems.reduce(
      (total, item) => {
        const quantity =
          selectedItems[
            item.id
          ] ?? 0;

        if (!quantity) {
          return total;
        }

        const unitValue =
          Number(item.total) /
          Math.max(
            1,
            Number(
              item.quantity,
            ),
          );

        return (
          total +
          unitValue *
            quantity
        );
      },
      0,
    );

  return (
    <PageShell>
      <PageHeader
        icon={RotateCcw}
        title="Devoluciones"
        description="Busca una venta por folio y devuelve productos. Las existencias regresan al inventario central compartido."
        action={
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([
                qc.invalidateQueries({
                  queryKey: [
                    "recent-sales-refund",
                  ],
                }),

                qc.invalidateQueries({
                  queryKey: [
                    "shared-inventory",
                  ],
                }),
              ]);
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">
              Ventas recientes
            </CardTitle>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                value={folioSearch}
                onChange={(
                  event,
                ) =>
                  setFolioSearch(
                    event.target
                      .value,
                  )
                }
                placeholder="Buscar folio..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  Folio
                </TableHead>

                <TableHead>
                  Fecha
                </TableHead>

                <TableHead>
                  Total
                </TableHead>

                <TableHead>
                  Pago
                </TableHead>

                <TableHead>
                  Estado
                </TableHead>

                <TableHead className="text-right">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Cargando ventas...
                  </TableCell>
                </TableRow>
              )}

              {!isLoading &&
                filteredSales.length ===
                  0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No hay ventas
                      disponibles para
                      devolver.
                    </TableCell>
                  </TableRow>
                )}

              {filteredSales.map(
                (sale) => (
                  <TableRow
                    key={sale.id}
                  >
                    <TableCell className="font-mono font-semibold">
                      #{sale.folio}
                    </TableCell>

                    <TableCell className="text-sm">
                      {new Date(
                        sale.created_at,
                      ).toLocaleString(
                        "es-MX",
                      )}
                    </TableCell>

                    <TableCell className="font-medium">
                      {money(
                        Number(
                          sale.total,
                        ),
                      )}
                    </TableCell>

                    <TableCell className="capitalize">
                      {
                        sale.payment_method
                      }
                    </TableCell>

                    <TableCell>
                      {statusBadge(
                        sale.status,
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openRefund(
                            sale.id,
                          )
                        }
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Devolver
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(
          open,
        ) => {
          setDialogOpen(open);

          if (!open) {
            setSelectedItems(
              {},
            );
            setReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Registrar devolución
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              {loadingItems && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Cargando productos...
                </p>
              )}

              {!loadingItems &&
                saleItems.map(
                  (item) => {
                    const checked =
                      item.id in
                      selectedItems;

                    const selectedQty =
                      selectedItems[
                        item.id
                      ] ??
                      Number(
                        item.quantity,
                      );

                    return (
                      <div
                        key={
                          item.id
                        }
                        className="flex items-center gap-3 rounded-lg border p-3"
                      >
                        <Checkbox
                          checked={
                            checked
                          }
                          onCheckedChange={(
                            value,
                          ) =>
                            toggleItem(
                              item,
                              Boolean(
                                value,
                              ),
                            )
                          }
                        />

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {
                              item.name_snapshot
                            }
                          </p>

                          <p className="text-xs text-muted-foreground">
                            {
                              item.quantity
                            }{" "}
                            ×{" "}
                            {money(
                              Number(
                                item.unit_price,
                              ),
                            )}
                          </p>
                        </div>

                        {checked && (
                          <Input
                            type="number"
                            min={1}
                            max={
                              Number(
                                item.quantity,
                              )
                            }
                            value={
                              selectedQty
                            }
                            onChange={(
                              event,
                            ) =>
                              setRefundQty(
                                item.id,
                                Number(
                                  event
                                    .target
                                    .value,
                                ),
                                Number(
                                  item.quantity,
                                ),
                              )
                            }
                            className="h-8 w-20"
                          />
                        )}
                      </div>
                    );
                  },
                )}

              {!loadingItems &&
                !saleItems.length && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Esta venta no
                    contiene
                    productos.
                  </p>
                )}
            </div>

            <div className="space-y-1.5">
              <Label>
                Motivo
                (opcional)
              </Label>

              <Input
                value={reason}
                onChange={(
                  event,
                ) =>
                  setReason(
                    event.target
                      .value,
                  )
                }
                placeholder="Ej. Producto defectuoso, cambio..."
              />
            </div>

            {refundTotal >
              0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <span className="text-sm font-medium">
                  Importe estimado
                </span>

                <span className="font-bold">
                  {money(
                    refundTotal,
                  )}
                </span>
              </div>
            )}

            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
              Al confirmar, Lula OS
              registrará la devolución
              mediante la operación
              transaccional y restaurará
              la existencia disponible
              en el inventario central.
            </div>

            {sharedInventory.length >
              0 && (
              <div className="text-xs text-muted-foreground">
                Inventario central:
                {" "}
                {
                  sharedInventory.length
                }{" "}
                productos con
                existencia registrada.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDialogOpen(
                 