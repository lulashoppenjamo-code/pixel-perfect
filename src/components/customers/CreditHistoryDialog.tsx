import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  Landmark,
  Loader2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CreditHistoryRow = {
  movement_type: "credit_sale" | "payment" | string;
  movement_id: string;
  movement_date: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  sale_folio: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  customerName?: string;
  balance?: number;
};

const methodLabel: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Crédito",
};

function MethodIcon({ method }: { method: string | null }) {
  if (method === "cash") {
    return <Banknote className="h-3.5 w-3.5" />;
  }

  if (method === "card") {
    return <CreditCard className="h-3.5 w-3.5" />;
  }

  return <Landmark className="h-3.5 w-3.5" />;
}

export function CreditHistoryDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  balance = 0,
}: Props) {
  const {
    data: history = [],
    isLoading,
    isError,
  } = useQuery<CreditHistoryRow[]>({
    queryKey: ["customer-credit-history", customerId],

    enabled: open && !!customerId,

    queryFn: async () => {
      if (!customerId) {
        return [];
      }

      const { data, error } = await (supabase as any).rpc(
        "get_customer_credit_history",
        {
          _customer_id: customerId,
        },
      );

      if (error) {
        throw error;
      }

      return (data ?? []) as CreditHistoryRow[];
    },
  });

  const creditTotal = history
    .filter(
      (row) => row.movement_type === "credit_sale",
    )
    .reduce(
      (sum, row) =>
        sum + Number(row.amount ?? 0),
      0,
    );

  const paymentsTotal = history
    .filter(
      (row) => row.movement_type === "payment",
    )
    .reduce(
      (sum, row) =>
        sum + Number(row.amount ?? 0),
      0,
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            Historial de crédito
          </DialogTitle>

          {customerName && (
            <p className="text-sm text-muted-foreground">
              {customerName}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                Ventas a crédito
              </p>

              <p className="mt-1 font-semibold">
                {money(creditTotal)}
              </p>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                Abonos
              </p>

              <p className="mt-1 font-semibold">
                {money(paymentsTotal)}
              </p>
            </div>

            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                Saldo actual
              </p>

              <p className="mt-1 font-semibold">
                {money(balance)}
              </p>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cargando historial…
            </div>
          )}

          {isError && !isLoading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              No se pudo cargar el historial de crédito.
            </div>
          )}

          {!isLoading &&
            !isError &&
            history.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Este cliente todavía no tiene movimientos de crédito.
              </div>
            )}

          {!isLoading &&
            !isError &&
            history.length > 0 && (
              <div className="space-y-2">
                {history.map((row) => {
                  const sale =
                    row.movement_type ===
                    "credit_sale";

                  return (
                    <div
                      key={row.movement_id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <div className="rounded-full bg-muted p-2">
                        {sale ? (
                          <ArrowUpCircle className="h-4 w-4" />
                        ) : (
                          <ArrowDownCircle className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {sale
                              ? "Venta a crédito"
                              : "Abono"}
                          </span>

                          <Badge
                            variant={
                              sale
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {sale
                              ? row.sale_folio
                                ? `Folio ${row.sale_folio}`
                                : "Crédito"
                              : methodLabel[
                                    row.payment_method ??
                                      ""
                                  ] ??
                                  row.payment_method ??
                                  "Abono"}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            row.movement_date,
                          ).toLocaleString("es-MX")}
                        </p>

                        {row.notes && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {row.notes}
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <div
                          className={
                            sale
                              ? "font-semibold text-destructive"
                              : "font-semibold text-emerald-600"
                          }
                        >
                          {sale ? "+" : "-"}
                          {money(
                            Number(
                              row.amount ?? 0,
                            ),
                          )}
                        </div>

                        {!sale &&
                          row.payment_method && (
                            <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                              <MethodIcon
                                method={
                                  row.payment_method
                                }
                              />

                              {methodLabel[
                                row.payment_method
                              ] ??
                                row.payment_method}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() =>
              onOpenChange(false)
            }
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}