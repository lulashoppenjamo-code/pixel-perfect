import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, PackageOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  deleteParkedSale,
  listParkedSales,
  type ParkedSaleRow,
} from "@/lib/parkedSales";
import { money } from "@/lib/format";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type ParkedSalesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string | null;
  onRecover: (sale: ParkedSaleRow) => void;
};

function getParkedSaleTotal(sale: ParkedSaleRow): number {
  const subtotal = sale.cart.reduce(
    (sum, line) =>
      sum +
      Number(line.unit_price || 0) * Number(line.quantity || 0) -
      Number(line.discount || 0),
    0,
  );

  const tax = sale.cart.reduce((sum, line) => {
    const base =
      Number(line.unit_price || 0) * Number(line.quantity || 0) -
      Number(line.discount || 0);

    return sum + base * Number(line.tax_rate || 0);
  }, 0);

  return Math.max(
    0,
    subtotal + tax - Number(sale.ticket_discount || 0),
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function ParkedSalesDialog({
  open,
  onOpenChange,
  branchId,
  onRecover,
}: ParkedSalesDialogProps) {
  const qc = useQueryClient();

  const {
    data: parkedSales = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["pos-parked-sales", branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      if (!branchId) {
        return [];
      }

      return listParkedSales(
        supabase,
        branchId,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteParkedSale(
        supabase,
        id,
      );
    },

    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["pos-parked-sales", branchId],
      });

      toast.success("Venta apartada eliminada");
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la venta apartada",
      );
    },
  });

  const count = useMemo(
    () => parkedSales.length,
    [parkedSales],
  );

  const recover = (sale: ParkedSaleRow) => {
    onRecover(sale);
    onOpenChange(false);
  };

  const remove = (sale: ParkedSaleRow) => {
    const confirmed = window.confirm(
      `¿Eliminar la venta apartada${
        sale.label ? ` "${sale.label}"` : ""
      }?\n\nEsta acción no afecta inventario ni caja.`,
    );

    if (!confirmed) {
      return;
    }

    deleteMutation.mutate(sale.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            Ventas apartadas
            {count > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({count})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-2">
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando ventas apartadas…
            </div>
          ) : parkedSales.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <PackageOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />

              <p className="font-medium">
                No hay ventas apartadas
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Cuando apartes un carrito aparecerá aquí.
              </p>

              <Button
                className="mt-4"
                variant="outline"
                onClick={() => refetch()}
              >
                Actualizar
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {parkedSales.map((sale) => {
                const total =
                  getParkedSaleTotal(sale);

                const itemCount =
                  sale.cart.reduce(
                    (sum, line) =>
                      sum +
                      Number(
                        line.quantity || 0,
                      ),
                    0,
                  );

                return (
                  <div
                    key={sale.id}
                    className="rounded-xl border bg-background p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {sale.label ||
                            "Venta apartada"}
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDate(
                              sale.created_at,
                            )}
                          </span>

                          <span>
                            {itemCount}{" "}
                            {itemCount === 1
                              ? "artículo"
                              : "artículos"}
                          </span>
                        </div>
                      </div>

                      <p className="shrink-0 text-lg font-bold">
                        {money(total)}
                      </p>
                    </div>

                    {sale.notes && (
                      <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                        {sale.notes}
                      </div>
                    )}

                    <div className="mt-3 flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={() =>
                          recover(sale)
                        }
                      >
                        Recuperar
                      </Button>

                      <Button
                        variant="outline"
                        size="icon"
                        title="Eliminar venta apartada"
                        disabled={
                          deleteMutation.isPending
                        }
                        onClick={() =>
                          remove(sale)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}