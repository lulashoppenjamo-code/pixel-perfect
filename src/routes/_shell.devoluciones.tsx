import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  RotateCcw,
  PackageCheck,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";

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
        title: "Devoluciones — Lula OS",
      },
      {
        name: "description",
        content:
          "Gestiona devoluciones de ventas y reintegra mercancía al inventario central.",
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
  folio: string | number;
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

function statusLabel(status: string) {
  switch (status) {
    case "completed":
      return "Completada";

    case "partially_refunded":
      return "Parcialmente devuelta";

    case "refunded":
      return "Devuelta";

    case "cancelled":
      return "Cancelada";

    default:
      return status;
  }
}

function paymentLabel(method: string) {
  switch (method) {
    case "cash":
      return "Efectivo";

    case "card":
      return "Tarjeta";

    case "transfer":
      return "Transferencia";

    case "mixed":
      return "Mixto";

    case "credit":
      return "Crédito";

    default:
      return method;
  }
}

function DevolucionesPage() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();

  const [folioSearch, setFolioSearch] =
    useState("");

  const [selectedSaleId, setSelectedSaleId] =
    useState<string | null>(null);

  const [selectedItems, setSelectedItems] =
    useState<Record<string, number>>({});

  const [reason, setReason] = useState("");

  const [dialogOpen, setDialogOpen] =
    useState(false);

  const {
    data: recentSales = [],
    isLoading,
    isError,
  } = useQuery<SaleRow[]>({
    queryKey: [
      "recent-sales-refund",
      branchId,
    ],

    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } = await supabase
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
        .eq("branch_id", branchId!)
        .in("status", [
          "completed",
          "partially_refunded",
        ])
        .order("created_at", {
          ascending: false,
        })
        .limit(100);

      if (error) {
        throw error;
      }

      return (data ?? []) as SaleRow[];
    },
  });

  const filteredSales = useMemo(() => {
    const search =
      folioSearch.trim().toLowerCase();

    if (!search) {
      return recentSales;
    }

    return recentSales.filter((sale) =>
      String(sale.folio)
        .toLowerCase()
        .includes(search),
    );
  }, [recentSales, folioSearch]);

  const selectedSale = useMemo(
    () =>
      recentSales.find(
        (sale) =>
          sale.id === selectedSaleId,
      ) ?? null,
    [recentSales, selectedSaleId],
  );

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
          )
          .order("created_at");

      if (error) {
        throw error;
      }

      return (data ??
        []) as SaleItem[];
    },
  });

  const selectedRefundTotal = useMemo(
    () =>
      saleItems.reduce(
        (total, item) => {
          const quantity =
            selectedItems[item.id] ?? 0;

          if (quantity <= 0) {
            return total;
          }

          const itemTotal =
            Number(item.total ?? 0);

          const itemQuantity =
            Number(item.quantity ?? 0);

          if (
            itemQuantity <= 0 ||
            itemTotal <= 0
          ) {
            return total;
          }

          return (
            total +
            (itemTotal /
              itemQuantity) *
              quantity
          );
        },
        0,
      ),
    [saleItems, selectedItems],
  );

  const openRefund = (
    saleId: string,
  ) => {
    if (!isManager) {
      toast.error(
        "Solo un gerente puede registrar devoluciones.",
      );
      return;
    }

    setSelectedSaleId(saleId);
    setSelectedItems({});
    setReason("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (refund.isPending) {
      return;
    }

    setDialogOpen(false);
    setSelectedSaleId(null);
    setSelectedItems({});
    setReason("");
  };

  const toggleItem = (
    item: SaleItem,
    checked: boolean,
  ) => {
    setSelectedItems((previous) => {
      const next = {
        ...previous,
      };

      if (checked) {
        next[item.id] = Math.max(
          1,
          Number(item.quantity),
        );
      } else {
        delete next[item.id];
      }

      return next;
    });
  };

  const setQty = (
    itemId: string,
    quantity: number,
    max: number,
  ) => {
    if (!Number.isFinite(quantity)) {
      return;
    }

    const value = Math.min(
      Math.max(1, Math.floor(quantity)),
      max,
    );

    setSelectedItems((previous) => ({
      ...previous,
      [itemId]: value,
    }));
  };

  const refund = useMutation({
    mutationFn: async () => {
      if (!isManager) {
        throw new Error(
          "Solo un gerente puede registrar devoluciones.",
        );
      }

      if (!selectedSaleId) {
        throw new Error(
          "No hay una venta seleccionada.",
        );
      }

      if (!branchId) {
        throw new Error(
          "No hay una sucursal activa.",
        );
      }

      const items = Object.entries(
        selectedItems,
      )
        .map(
          ([
            sale_item_id,
            quantity,
          ]) => ({
            sale_item_id,
            quantity,
          }),
        )
        .filter(
          (item) =>
            Number(item.quantity) > 0,
        );

      if (!items.length) {
        throw new Error(
          "Selecciona al menos un producto.",
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

    onSuccess: () => {
      toast.success(
        "Devolución registrada. El inventario compartido fue actualizado.",
      );

      closeDialog();

      void Promise.all([
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

        qc.invalidateQueries({
          queryKey: [
            "inventory-movements",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "sales",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "reports",
          ],
        }),

        qc.invalidateQueries({
          queryKey: [
            "ceo",
          ],
        }),
      ]);
    },

    onError: (error: Error) => {
      toast.error(
        error.message ||
          "No se pudo registrar la devolución.",
      );
    },
  });

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

    return (
      <Badge
        variant={
          variants[status] ??
          "outline"
        }
      >
        {statusLabel(status)}
      </Badge>
    );
  };

  return (
    <PageShell>
      <PageHeader
        icon={RotateCcw}
        title="Devoluciones"
        description="Busca una venta por folio y devuelve productos al inventario central compartido."
      />

      {!isManager && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <PackageCheck className="size-5 text-amber-600" />

            <div>
              <p className="font-medium">
                Consulta de devoluciones
              </p>

              <p className="text-sm text-muted-foreground">
                Tu usuario puede consultar
                las ventas, pero el registro
                de devoluciones requiere
                permisos de gerente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">
            No se pudieron cargar las ventas.
            Verifica la sucursal activa y tu
            conexión.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">
              Ventas recientes
            </CardTitle>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                value={folioSearch}
                onChange={(event) =>
                  setFolioSearch(
                    event.target.value,
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
                      No hay ventas disponibles
                      para devolver.
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

                    <TableCell>
                      {paymentLabel(
                        sale.payment_method,
                      )}
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
                        disabled={
                          !isManager
                        }
                        onClick={() =>
                          openRefund(
                            sale.id,
                          )
                        }
                      >
                        <RotateCcw className="mr-1.5 size-3.5" />

                        {isManager
                          ? "Devolver"
                          : "Solo gerente"}
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
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Registrar devolución
              {selectedSale && (
                <span className="ml-2 font-mono text-muted-foreground">
                  #{selectedSale.folio}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              {loadingItems ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Cargando productos...
                </div>
              ) : (
                saleItems.map(
                  (item) => {
                    const checked =
                      item.id in
                      selectedItems;

                    const selectedQuantity =
                      selectedItems[
                        item.id
                      ] ??
                      item.quantity;

                    return (
                      <div
                        key={item.id}
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
                            {item.quantity}{" "}
                            disponibles
                            para devolución
                            {" · "}
                            {money(
                              Number(
                                item.unit_price,
                              ),
                            )}{" "}
                            c/u
                          </p>
                        </div>

                        {checked && (
                          <Input
                            type="number"
                            min={1}
                            max={
                              item.quantity
                            }
                            value={
                              selectedQuantity
                            }
                            onChange={(
                              event,
                            ) =>
                              setQty(
                                item.id,
                                Number(
                                  event
                                    .target
                                    .value,
                                ),
                                item.quantity,
                              )
                            }
                            className="h-8 w-20"
                          />
                        )}
                      </div>
                    );
                  },
                )
              )}

              {!loadingItems &&
                !saleItems.length && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Esta venta no tiene
                    productos disponibles
                    para devolución.
                  </p>
                )}
            </div>

            {Object.keys(
              selectedItems,
            ).length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                <span className="text-sm font-medium">
                  Total estimado a devolver
                </span>

                <span className="font-bold">
                  {money(
                    selectedRefundTotal,
                  )}
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>
                Motivo
                <span className="ml-1 text-muted-foreground">
                  (opcional)
                </span>
              </Label>

              <Input
                value={reason}
                onChange={(event) =>
                  setReason(
                    event.target.value,
                  )
                }
                placeholder="Ej. Producto defectuoso, cambio de talla..."
                disabled={
                  refund.isPending
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={
                refund.isPending
              }
            >
              Cancelar
            </Button>

            <Button
              disabled={
                Object.keys(
                  selectedItems,
                ).length === 0 ||
                refund.isPending ||
                loadingItems ||
                !isManager
              }
              onClick={() =>
                refund.mutate()
              }
            >
              {refund.isPending
                ? "Procesando..."
                : "Confirmar devolución"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}