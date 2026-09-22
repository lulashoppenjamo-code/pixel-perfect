/**
 * Ticket de venta imprimible — LULA OS
 * Ruta: src/components/pos/TicketModal.tsx
 * Reemplaza el archivo existente completo.
 */
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money } from "@/lib/format";

export type TicketLine = {
  name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
};

export type TicketData = {
  companyName?: string | undefined;
  branchName?: string | undefined;
  folio: number | string;
  date: string;
  cashierName?: string | undefined;
  customerName?: string | undefined;
  paymentMethod: string;
  lines: TicketLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  cashReceived?: number | null | undefined;
  changeGiven?: number | null | undefined;
  footer?: string | undefined;
};

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  credit: "Crédito",
  mixed: "Mixto",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;
};

export function TicketModal({ open, onOpenChange, ticket }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current || !ticket) return;
    const html = printRef.current.innerHTML;
    const w = window.open("", "_blank", "width=320,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Ticket ${ticket.folio}</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; margin: 8px; color: #000; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .line { border-top: 1px dashed #333; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 2px 0; }
  td.qty { width: 28px; }
  td.price { text-align: right; white-space: nowrap; }
  h1 { font-size: 14px; margin: 0 0 4px; }
  @media print { body { margin: 0; } }
</style></head><body>${html}
<script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}</script>
</body></html>`);
    w.document.close();
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ticket — Folio {ticket.folio}</DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="rounded-md border bg-white p-4 text-black">
          <div className="center space-y-1">
            <h1 className="font-bold">{ticket.companyName ?? "Lula Shop"}</h1>
            {ticket.branchName && <p className="text-xs">{ticket.branchName}</p>}
            <p className="text-xs">{ticket.date}</p>
            <p className="text-xs font-semibold">Folio: {ticket.folio}</p>
          </div>

          <div className="line" />

          <div className="space-y-0.5 text-xs">
            {ticket.cashierName && (
              <div className="row">
                <span>Cajero:</span>
                <span>{ticket.cashierName}</span>
              </div>
            )}
            {ticket.customerName && (
              <div className="row">
                <span>Cliente:</span>
                <span>{ticket.customerName}</span>
              </div>
            )}
            <div className="row">
              <span>Pago:</span>
              <span>{PAYMENT_LABEL[ticket.paymentMethod] ?? ticket.paymentMethod}</span>
            </div>
          </div>

          <div className="line" />

          <table>
            <tbody>
              {ticket.lines.map((l, i) => (
                <tr key={i}>
                  <td className="qty">{l.quantity}</td>
                  <td>
                    <div>{l.name}</div>
                    {l.discount && l.discount > 0 ? (
                      <div className="text-[10px] text-gray-600">Desc. {money(l.discount)}</div>
                    ) : null}
                  </td>
                  <td className="price">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="line" />

          <div className="space-y-0.5 text-xs">
            <div className="row">
              <span>Subtotal</span>
              <span>{money(ticket.subtotal)}</span>
            </div>
            <div className="row">
              <span>Impuestos</span>
              <span>{money(ticket.tax)}</span>
            </div>
            {ticket.discount > 0 && (
              <div className="row">
                <span>Descuento</span>
                <span>-{money(ticket.discount)}</span>
              </div>
            )}
            <div className="row text-sm font-bold">
              <span>TOTAL</span>
              <span>{money(ticket.total)}</span>
            </div>
            {ticket.cashReceived != null && (
              <>
                <div className="row">
                  <span>Recibido</span>
                  <span>{money(ticket.cashReceived)}</span>
                </div>
                <div className="row">
                  <span>Cambio</span>
                  <span>{money(ticket.changeGiven ?? 0)}</span>
                </div>
              </>
            )}
          </div>

          {ticket.footer && (
            <>
              <div className="line" />
              <p className="center text-xs">{ticket.footer}</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={handlePrint}>Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
