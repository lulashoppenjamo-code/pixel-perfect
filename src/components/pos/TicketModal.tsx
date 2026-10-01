/**
 * Ticket de venta imprimible — LULA OS
 * Ruta: src/components/pos/TicketModal.tsx
 */

import { useRef } from "react";
import { Share2 } from "lucide-react";
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
};

export function TicketModal({
  open,
  onOpenChange,
  ticket,
  layout: layoutProp,
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

  if (!ticket) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Ticket — Folio {ticket.folio}
          </DialogTitle>
        </DialogHeader>

        <div
          ref={printRef}
          className="rounded-md border bg-white p-4 text-black"
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() =>
              onOpenChange(false)
            }
          >
            Cerrar
          </Button>

          <Button
            variant="outline"
            onClick={handleShare}
          >
            <Share2 className="mr-1.5 h-4 w-4" />
            Compartir
          </Button>

          <Button
            onClick={handlePrint}
          >
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}