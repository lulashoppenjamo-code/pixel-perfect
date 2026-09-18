/**
 * Ticket de venta imprimible — FASE 2
 * Ruta: src/components/pos/TicketModal.tsx
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
  companyName?: string;
  branchName?: string;
  folio: number | string;
  date: string;
  cashierName?: string;
  customerName?: string;
  paymentMethod: string;
  lines: TicketLine[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  cashReceived?: number | null;
  changeGiven?: number | null;
  footer?: string;
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
    if (!printRef.current) return;
    const html = printRef.current.innerHTML;
    const w = window.open("", "_blank", "width=320,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Ticket ${ticket?.folio ?? ""}</title>
<style>
  body { font-family: ui-monospace, monospace; font-size: 12px; margin: 8px; color: #000; }
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
<script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script>
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

        <div ref={printRef} className="rounded-md border bg-white p-3 text-xs text-black">
          <div className="center">
            <h1 className="text-sm font-bold">{ticket.companyName || "Lula Shop"}</h1>
            {ticket.branchName && <div>{ticket.branchName}</div>}
            <div>Folio: {ticket.folio}</div>
            <div>{ticket.date}</div>
          </div>
          <div className="line" />
          {ticket.cashierName && <div>Cajero: {ticket.cashierName}</div>}
          {ticket.customerName && <div>Cliente: {ticket.customerName}</div>}
          <div>Pago: {PAYMENT_LABEL[ticket.paymentMethod] ?? ticket.paymentMethod}</div>
          <div className="line" />
          <table>
            <tbody>
              {ticket.lines.map((l, i) => (
                <tr key={i}>
                  <td className="qty">{l.quantity}x</td>
                  <td>
                    {l.name}
                    {(l.discount ?? 0) > 0 && (
                      <div className="text-[10px] text-gray-600">Desc. -{money(l.discount!)}</div>
                    )}
                  </td>
                  <td className="price">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="line" />
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
              <span>Descuento</spa
... 