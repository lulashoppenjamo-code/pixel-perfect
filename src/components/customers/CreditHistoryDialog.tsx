import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CreditCard,
  Landmark,
  Loader2,
  Printer,
} from "lucide-react";
import { toast } from "sonner";

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

async function loadHistoryFallback(
  customerId: string,
): Promise<CreditHistoryRow[]> {
  const [salesRes, paymentsRes] = await Promise.all([
    supabase
      .from("sales")
      .select("id, folio, total, payment_method, created_at, status")
      .eq("customer_id", customerId)
      .eq("payment_method", "credit")
      .in("status", ["completed", "partially_refunded"]),
    supabase
      .from("credit_payments")
      .select("id, amount, payment_method, notes, created_at")
      .eq("customer_id", customerId),
  ]);

  if (salesRes.error) throw salesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const sales: CreditHistoryRow[] = (salesRes.data ?? []).map((s) => ({
    movement_type: "credit_sale",
    movement_id: s.id,
    movement_date: s.created_at,
    amount: Number(s.total ?? 0),
    payment_method: "credit",
    notes: null,
    sale_folio: s.folio != null ? String(s.folio) : null,
  }));

  const payments: CreditHistoryRow[] = (paymentsRes.data ?? []).map((p) => ({
    movement_type: "payment",
    movement_id: p.id,
    movement_date: p.created_at,
    amount: Number(p.amount ?? 0),
    payment_method: p.payment_method,
    notes: p.notes,
    sale_folio: null,
  }));

  return [...sales, ...payments].sort(
    (a, b) =>
      new Date(b.movement_date).getTime() -
      new Date(a.movement_date).getTime(),
  );
}

function printAbonoTicket(opts: {
  customerName: string;
  date: string;
  owedBefore: number;
  paid: number;
  remaining: number;
  method: string;
  notes?: string | null;
}) {
  const w = window.open("", "_blank", "width=360,height=640");
  if (!w) {
    toast.error("El navegador bloqueó la ventana de impresión.");
    return;
  }

  w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Abono — ${opts.customerName}</title>
  <style>
    body { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; margin: 12px; color: #000; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 8px; }
    .center { text-align: center; }
    .line { border-top: 1px dashed #333; margin: 10px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; }
    .bold { font-weight: 700; }
    .big { font-size: 15px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>COMPROBANTE DE ABONO</h1>
  <p class="center">Lula Shop</p>
  <div class="line"></div>
  <div class="row"><span>Cliente</span><span class="bold">${opts.customerName}</span></div>
  <div class="row"><span>Fecha</span><span>${opts.date}</span></div>
  <div class="row"><span>Método</span><span>${opts.method}</span></div>
  ${opts.notes ? `<div class="row"><span>Notas</span><span>${opts.notes}</span></div>` : ""}
  <div class="line"></div>
  <div class="row"><span>Debía</span><span>${money(opts.owedBefore)}</span></div>
  <div class="row"><span>Abonó</span><span class="bold">− ${money(opts.paid)}</span></div>
  <div class="line"></div>
  <div class="row big"><span>Resta</span><span>${money(opts.remaining)}</span></div>
  <div class="line"></div>
  <p class="center">Gracias por su pago</p>
  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 400);
    };
  </script>
</body>
</html>`);
  w.document.close();
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
      if (!customerId) return [];

      const { data, error } = await (supabase as any).rpc(
        "get_customer_credit_history",
        { _customer_id: customerId },
      );

      if (!error) {
        return (data ?? []) as CreditHistoryRow[];
      }

      const msg = String(error.message ?? "").toLowerCase();
      if (
        msg.includes("could not find the function") ||
        msg.includes("get_customer_credit_history") ||
        msg.includes("schema cache")
      ) {
        return loadHistoryFallback(customerId);
      }

      throw error;
    },
  });

  const creditTotal = history
    .filter((row) => row.movement_type === "credit_sale")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const paymentsTotal = history
    .filter((row) => row.movement_type === "payment")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  /**
   * Chronological (oldest → newest) with running balance
   * after each movement, then reverse for display (newest first).
   */
  const rowsWithBalance = useMemo(() => {
    const chrono = [...history].sort(
      (a, b) =>
        new Date(a.movement_date).getTime() -
        new Date(b.movement_date).getTime(),
    );

    let running = 0;
    const enriched = chrono.map((row) => {
      const amount = Number(row.amount ?? 0);
      const isSale = row.movement_type === "credit_sale";
      const balanceBefore = running;
      if (isSale) {
        running += amount;
      } else {
        running = Math.max(0, running - amount);
      }
      return {
        ...row,
        balanceBefore,
        balanceAfter: running,
        isSale,
      };
    });

    return enriched.reverse();
  }, [history]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Historial de crédito
            {customerName ? ` — ${customerName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-3 text-center text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">Compras crédito</p>
            <p className="font-bold text-destructive">{money(creditTotal)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Abonos</p>
            <p className="font-bold text-emerald-600">{money(paymentsTotal)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Saldo</p>
            <p className="font-bold">{money(balance)}</p>
          </div>
        </div>

        <div className="min-h-[12rem]">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando historial…
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              No se pudo cargar el historial.
            </p>
          ) : rowsWithBalance.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin movimientos de crédito todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {rowsWithBalance.map((row) => {
                const sale = row.isSale;
                return (
                  <div
                    key={`${row.movement_type}-${row.movement_id}`}
                    className="rounded-xl border bg-white p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className={
                          sale
                            ? "mt-0.5 rounded-full bg-red-50 p-1.5 text-destructive"
                            : "mt-0.5 rounded-full bg-emerald-50 p-1.5 text-emerald-600"
                        }
                      >
                        {sale ? (
                          <ArrowUpCircle className="h-4 w-4" />
                        ) : (
                          <ArrowDownCircle className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold">
                            {sale ? "Compra a crédito" : "Abono"}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {sale
                              ? row.sale_folio
                                ? `Folio ${row.sale_folio}`
                                : "Crédito"
                              : methodLabel[row.payment_method ?? ""] ??
                                row.payment_method ??
                                "Abono"}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {new Date(row.movement_date).toLocaleString("es-MX")}
                        </p>

                        {row.notes ? (
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {row.notes}
                          </p>
                        ) : null}

                        {!sale && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Debía {money(row.balanceBefore)} · Resta{" "}
                            {money(row.balanceAfter)}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <div
                          className={
                            sale
                              ? "text-sm font-semibold text-destructive"
                              : "text-sm font-semibold text-emerald-600"
                          }
                        >
                          {sale ? "+" : "−"}
                          {money(Number(row.amount ?? 0))}
                        </div>

                        {!sale && row.payment_method ? (
                          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                            <MethodIcon method={row.payment_method} />
                            {methodLabel[row.payment_method] ??
                              row.payment_method}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {!sale && (
                      <div className="mt-2 flex justify-end border-t pt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() =>
                            printAbonoTicket({
                              customerName:
                                customerName || "Cliente",
                              date: new Date(
                                row.movement_date,
                              ).toLocaleString("es-MX"),
                              owedBefore: row.balanceBefore,
                              paid: Number(row.amount ?? 0),
                              remaining: row.balanceAfter,
                              method:
                                methodLabel[
                                  row.payment_method ?? ""
                                ] ??
                                row.payment_method ??
                                "Abono",
                              notes: row.notes,
                            })
                          }
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Reimprimir ticket
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            className="min-h-11 w-full touch-manipulation sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
 