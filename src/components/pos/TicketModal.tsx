/**
 * Ticket de venta imprimible — LULA OS
 * Ruta: src/components/pos/TicketModal.tsx
 */

import { useRef } from "react";
import {
  Share2,
  ArrowLeft,
  MessageSquare,
  Download,
  Printer,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { money } from "@/lib/format";

import {
  getCachedTicketLayout,
  type TicketPrintLayout,
} from "@/lib/bluetoothPrinter";

export type TicketLine = {
  name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
  sku?: string | null;
};

export type TicketData = {
  companyName?: string | undefined;
  companyAddress?: string | undefined;
  companyPhone?: string | undefined;

  /**
   * Logo del ticket en formato data URL.
   *
   * Es opcional para no romper tickets históricos
   * ni tickets generados antes de configurar el logo.
   */
  logoDataUrl?: string | undefined;

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

const TICKET_LOGO_CACHE_KEY = "lula-ticket-logo";

function getCachedTicketLogo(): string {
  try {
    return localStorage.getItem(
      TICKET_LOGO_CACHE_KEY,
    ) ?? "";
  } catch {
    return "";
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;

  /**
   * Opcional.
   * Si no se pasa, usa el layout cacheado de settings.
   */
  layout?: Partial<TicketPrintLayout>;

  /**
   * "dialog" = modal clásico (POS).
   * "fullscreen" = detalle estilo Zobaze (módulo Hoy).
   */
  variant?: "dialog" | "fullscreen";

  /** DEVOLVER — navega o abre flujo de devolución */
  onReturn?: (() => void) | undefined;

  /** BORRAR — cancelar venta (RPC cancel_sale) */
  onDelete?: (() => void) | undefined;

  /** EDITAR — opcional; si no hay handler se muestra aviso */
  onEdit?: (() => void) | undefined;

  /** Deshabilitar acciones mientras hay mutación */
  actionsPending?: boolean | undefined;

  /** Ocultar BORRAR si la venta ya no es cancelable */
  canDelete?: boolean | undefined;
};

export function TicketModal({
  open,
  onOpenChange,
  ticket,
  layout: layoutProp,
  variant = "dialog",
  onReturn,
  onDelete,
  onEdit,
  actionsPending = false,
  canDelete = true,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const layout: TicketPrintLayout = {
    ...getCachedTicketLayout(),
    ...layoutProp,
  };

  const resolvedLogo =
    ticket?.logoDataUrl ||
    getCachedTicketLogo() ||
    "";

  const handlePrint = () => {
    if (!printRef.current || !ticket) return;

    const html =
      printRef.current.innerHTML;

    const w = window.open(
      "",
      "_blank",
      "width=320,height=700",
    );

    if (!w) {
      toast.error(
        "El navegador bloqueó la ventana de impresión.",
      );
      return;
    }

    w.document.write(`
<!DOCTYPE html>
<html>
<head>
  <title>Ticket ${ticket.folio}</title>

  <style>
    body {
      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        monospace;

      font-size: 12px;
      margin: 8px;
      color: #000;
      background: #fff;
    }

    .center {
      text-align: center;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .line {
      border-top: 1px dashed #333;
      margin: 6px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    td {
      vertical-align: top;
      padding: 2px 0;
    }

    td.qty {
      width: 28px;
    }

    td.price {
      text-align: right;
      white-space: nowrap;
    }

    h1 {
      font-size: 14px;
      margin: 0 0 4px;
    }

    .ticket-logo {
      display: block;
      max-width: 85%;
      max-height: 110px;
      margin: 0 auto 8px;
      object-fit: contain;
    }

    @media print {
      body {
        margin: 0;
      }

      .ticket-logo {
        max-width: 85%;
        max-height: 100px;
      }
    }
  </style>
</head>

<body>
  ${html}

  <script>
    window.onload = function () {
      window.print();

      setTimeout(function () {
        window.close();
      }, 500);
    };
  </script>
</body>
</html>
`);

    w.document.close();
  };

  const buildShareText = (
    t: TicketData,
  ) => {
    const lines = [
      `${t.companyName ?? "Lula Shop"}${
        layout.showBranch && t.branchName
          ? " — " + t.branchName
          : ""
      }`,

      ...(t.companyAddress
        ? [t.companyAddress]
        : []),

      ...(t.companyPhone
        ? [`Tel: ${t.companyPhone}`]
        : []),

      `Folio: ${t.folio}`,

      t.date,

      "",

      ...t.lines.map((l) => {
        const skuPart =
          layout.showSku && l.sku
            ? ` [SKU: ${l.sku}]`
            : "";

        return `${l.quantity} x ${l.name}${skuPart} — ${money(
          l.total,
        )}`;
      }),

      "",

      `Subtotal: ${money(t.subtotal)}`,

      ...(layout.showTaxes
        ? [`Impuestos: ${money(t.tax)}`]
        : []),

      ...(layout.showDiscounts &&
      t.discount > 0
        ? [
            `Descuento: -${money(
              t.discount,
            )}`,
          ]
        : []),

      `TOTAL: ${money(t.total)}`,

      ...(t.footer
        ? ["", t.footer]
        : []),
    ];

    return lines.join("\n");
  };

  const handleShare = async () => {
    if (!ticket) return;

    const text =
      buildShareText(ticket);

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Ticket ${ticket.folio}`,
          text,
        });
      } catch {
        // El usuario canceló el share.
      }

      return;
    }

    const url =
      `https://wa.me/?text=${encodeURIComponent(
        text,
      )}`;

    window.open(
      url,
      "_blank",
    );

    toast.info(
      "Abriendo WhatsApp para compartir el ticket",
    );
  };

  const handleWhatsApp = () => {
    if (!ticket) return;
    const text = buildShareText(ticket);
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  };

  const handleDownload = () => {
    if (!ticket) return;
    const text = buildShareText(ticket);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ticket-${ticket.folio}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ticket descargado");
  };

  const handleEditClick = () => {
    if (onEdit) {
      onEdit();
      return;
    }
    toast.message("La edición de tickets estará disponible pronto.");
  };

  if (!ticket) {
    return null;
  }

  const itemCount = ticket.lines.length;
  const unitCount = ticket.lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0),
    0,
  );
  const payLabel =
    PAYMENT_LABEL[ticket.paymentMethod] ?? ticket.paymentMethod;

  const ticketBody = (
        <div
          ref={printRef}
          className={
            variant === "fullscreen"
              ? "bg-white p-4 text-black"
              : "rounded-md border bg-white p-4 text-black"
          }
        >
          <div className="center space-y-1">

            {resolvedLogo ? (
              <img
                src={resolvedLogo}
                alt="Lula Shop"
                className="ticket-logo mx-auto mb-2 max-h-28 max-w-[85%] object-contain"
              />
            ) : null}

            <h1 className="font-bold">
              {ticket.companyName ??
                "Lula Shop"}
            </h1>

            {ticket.companyAddress ? (
              <p className="text-xs">
                {ticket.companyAddress}
              </p>
            ) : null}

            {ticket.companyPhone ? (
              <p className="text-xs">
                Tel: {ticket.companyPhone}
              </p>
            ) : null}

            {layout.showBranch &&
            ticket.branchName ? (
              <p className="text-xs">
                {ticket.branchName}
              </p>
            ) : null}

            <p className="text-xs">
              {ticket.date}
            </p>

            <p className="text-xs font-semibold">
              Folio: {ticket.folio}
            </p>
          </div>

          <div className="line" />

          <div className="space-y-0.5 text-xs">

            {layout.showCashier &&
            ticket.cashierName ? (
              <div className="row">
                <span>
                  Cajero:
                </span>

                <span>
                  {ticket.cashierName}
                </span>
              </div>
            ) : null}

            {layout.showCustomer &&
            ticket.customerName ? (
              <div className="row">
                <span>
                  Cliente:
                </span>

                <span>
                  {ticket.customerName}
                </span>
              </div>
            ) : null}

            <div className="row">
              <span>
                Pago:
              </span>

              <span>
                {PAYMENT_LABEL[
                  ticket.paymentMethod
                ] ??
                  ticket.paymentMethod}
              </span>
            </div>
          </div>

          <div className="line" />

          <table>
            <tbody>
              {ticket.lines.map(
                (l, i) => (
                  <tr key={i}>
                    <td className="qty">
                      {l.quantity}
                    </td>

                    <td>
                      <div>
                        {l.name}
                      </div>

                      {layout.showSku &&
                      l.sku ? (
                        <div className="text-[10px] text-gray-600">
                          SKU: {l.sku}
                        </div>
                      ) : null}

                      {layout.showDiscounts &&
                      l.discount &&
                      l.discount > 0 ? (
                        <div className="text-[10px] text-gray-600">
                          Desc.{" "}
                          {money(
                            l.discount,
                          )}
                        </div>
                      ) : null}
                    </td>

                    <td className="price">
                      {money(l.total)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <div className="line" />

          <div className="space-y-0.5 text-xs">

            <div className="row">
              <span>
                Subtotal
              </span>

              <span>
                {money(
                  ticket.subtotal,
                )}
              </span>
            </div>

            {layout.showTaxes ? (
              <div className="row">
                <span>
                  Impuestos
                </span>

                <span>
                  {money(
                    ticket.tax,
                  )}
                </span>
              </div>
            ) : null}

            {layout.showDiscounts &&
            ticket.discount > 0 ? (
              <div className="row">
                <span>
                  Descuento
                </span>

                <span>
                  -
                  {money(
                    ticket.discount,
                  )}
                </span>
              </div>
            ) : null}

            <div className="row text-sm font-bold">
              <span>
                TOTAL
              </span>

              <span>
                {money(
                  ticket.total,
                )}
              </span>
            </div>

            {layout.showCashReceived &&
            ticket.cashReceived != null ? (
              <div className="row">
                <span>
                  Recibido
                </span>

                <span>
                  {money(
                    ticket.cashReceived,
                  )}
                </span>
              </div>
            ) : null}

            {layout.showChange &&
            ticket.cashReceived != null ? (
              <div className="row">
                <span>
                  Cambio
                </span>

                <span>
                  {money(
                    ticket.changeGiven ??
                      0,
                  )}
                </span>
              </div>
            ) : null}
          </div>

          {ticket.footer ? (
            <>
              <div className="line" />

              <p className="center text-xs">
                {ticket.footer}
              </p>
            </>
          ) : null}
        </div>
  );

  if (variant === "fullscreen") {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#f5f5f5]">
        {/* Barra superior acciones */}
        <div className="flex shrink-0 items-center gap-1 border-b border-[#e0e0e0] bg-white px-2 py-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleShare}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            title="Compartir"
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!ticket) return;
              const text = buildShareText(ticket);
              window.open(
                `sms:?body=${encodeURIComponent(text)}`,
                "_self",
              );
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            title="SMS"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleWhatsApp}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-white"
            title="WhatsApp"
          >
            <span className="text-xs font-bold">WA</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            title="Descargar"
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            title="Imprimir"
          >
            <Printer className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8]"
            title="Más"
            onClick={handleShare}
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>

        {/* DEVOLVER | BORRAR | EDITAR */}
        <div className="flex shrink-0 justify-end gap-2 bg-[#f5f5f5] px-3 py-2">
          <button
            type="button"
            disabled={actionsPending}
            onClick={() => onReturn?.()}
            className="rounded-md bg-[#1a73e8] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
          >
            Devolver
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={actionsPending || !onDelete}
              onClick={() => onDelete?.()}
              className="rounded-md bg-[#e53935] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
            >
              Borrar
            </button>
          )}
          <button
            type="button"
            disabled={actionsPending}
            onClick={handleEditClick}
            className="rounded-md bg-[#1a73e8] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
          >
            Editar
          </button>
        </div>

        {/* Contenido ticket estilo Zobaze */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <div className="mx-auto max-w-md overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-sm">
            {/* Encabezado visual */}
            <div className="space-y-2 px-4 pb-3 pt-5 text-center">
              {resolvedLogo ? (
                <img
                  src={resolvedLogo}
                  alt=""
                  className="mx-auto mb-2 max-h-24 max-w-[70%] object-contain"
                />
              ) : (
                <div className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#1a73e8] bg-[#e3f2fd] text-2xl font-bold text-[#1a73e8]">
                  L
                </div>
              )}
              <h1 className="text-base font-bold uppercase tracking-wide text-[#212121]">
                {ticket.companyName ?? "Lula Shop"}
              </h1>
              {ticket.companyAddress ? (
                <p className="whitespace-pre-line text-xs leading-relaxed text-[#616161]">
                  {ticket.companyAddress}
                </p>
              ) : null}
              {ticket.footer ? (
                <p className="whitespace-pre-line text-xs leading-relaxed text-[#616161]">
                  {ticket.footer}
                </p>
              ) : null}
              {ticket.companyPhone ? (
                <p className="text-xs text-[#616161]">
                  {ticket.companyPhone}
                </p>
              ) : null}
              {layout.showBranch && ticket.branchName ? (
                <p className="text-xs text-[#9e9e9e]">
                  Por : {ticket.branchName}
                </p>
              ) : null}
            </div>

            <div className="mx-4 border-t border-[#e0e0e0]" />

            <div className="space-y-1 px-4 py-3 text-center text-sm text-[#424242]">
              <p>Recibo # {ticket.folio}</p>
              <p>Fecha : {ticket.date}</p>
            </div>

            {/* Resumen pago */}
            <div className="overflow-x-auto px-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#eeeeee] text-[#424242]">
                    <th className="px-2 py-1.5 font-semibold">Modo P</th>
                    <th className="px-2 py-1.5 font-semibold">I#</th>
                    <th className="px-2 py-1.5 font-semibold">U #</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#f0f0f0]">
                    <td className="px-2 py-2">{payLabel}</td>
                    <td className="px-2 py-2">{itemCount}</td>
                    <td className="px-2 py-2">{unitCount}</td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {money(ticket.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Líneas */}
            <div className="overflow-x-auto px-2 pb-4 pt-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#eeeeee] text-[#424242]">
                    <th className="px-2 py-1.5 font-semibold">Nombre</th>
                    <th className="px-2 py-1.5 font-semibold">Precio</th>
                    <th className="px-2 py-1.5 font-semibold">Cant.</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.lines.map((line, i) => (
                    <tr key={i} className="border-b border-[#f5f5f5] align-top">
                      <td className="max-w-[9rem] px-2 py-2 leading-snug text-[#424242]">
                        {line.name}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {money(line.unit_price)}
                      </td>
                      <td className="px-2 py-2">{line.quantity}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {money(line.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Copia oculta para impresión clásica */}
            <div className="hidden">{ticketBody}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Ticket — Folio {ticket.folio}
          </DialogTitle>
        </DialogHeader>

        {ticketBody}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>

          <Button variant="outline" onClick={handleShare}>
            <Share2 className="mr-1.5 h-4 w-4" />
            Compartir
          </Button>

          <Button onClick={handlePrint}>Imprimir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}