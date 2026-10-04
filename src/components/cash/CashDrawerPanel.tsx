/**
 * Arqueo de caja — LULA OS
 * Componente: src/components/cash/CashDrawerPanel.tsx
 *
 * Control de caja por sucursal:
 * - Una sola sesión abierta por sucursal.
 * - Apertura con efectivo inicial.
 * - Entradas y salidas manuales.
 * - Ventas en efectivo.
 * - Pagos mixtos.
 * - Devoluciones y reembolsos en efectivo.
 * - Gastos pagados en efectivo.
 * - Cierre con efectivo contado.
 * - Diferencia contra efectivo esperado.
 *
 * IMPORTANTE:
 * El inventario sigue siendo compartido entre sucursales.
 * Caja sí permanece separada por sucursal.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Printer,
  Unlock,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { printTextBluetooth } from "@/lib/bluetoothPrinter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MovementType = "deposit" | "withdrawal";


const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-MX");


/** Fondo fijo de apertura (pesos) */
const DEFAULT_FONDO = 400;

/** Denominaciones MXN para el tablero de conteo */
const DENOMINATIONS: { value: number; label: string }[] = [
  { value: 1000, label: "$1,000" },
  { value: 500, label: "$500" },
  { value: 200, label: "$200" },
  { value: 100, label: "$100" },
  { value: 50, label: "$50" },
  { value: 20, label: "$20" },
  { value: 10, label: "$10" },
  { value: 5, label: "$5" },
  { value: 2, label: "$2" },
  { value: 1, label: "$1" },
  { value: 0.5, label: "$0.50" },
];

function emptyDenomCounts(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const d of DENOMINATIONS) {
    o[String(d.value)] = "";
  }
  return o;
}

function sumDenominations(counts: Record<string, string>): number {
  let total = 0;
  for (const d of DENOMINATIONS) {
    const n = Number(counts[String(d.value)] || 0);
    if (Number.isFinite(n) && n > 0) {
      total += n * d.value;
    }
  }
  return Math.round(total * 100) / 100;
}

const QUICK_REASONS: Record<MovementType, string[]> = {
  deposit: [
    "Ventas perfumes (otro sistema)",
    "Fondo adicional",
    "Otros ingresos en efectivo",
  ],
  withdrawal: [
    "Pedido domicilio no cobrado",
    "Pago proveedor / pedido",
    "Gasto menor",
    "Retiro a dueño",
  ],
};

type ArqueoPrintOpts = {
  branchLabel: string;
  openedAt: string;
  closedAt?: string | null;
  /** Nombre de quien abrió la sesión de caja */
  openedByName?: string | null;
  opening: number;
  cashSales: number;
  mixedCash: number;
  deposits: number;
  withdrawals: number;
  cashExpenses: number;
  expected: number;
  counted?: number | null;
  difference?: number | null;
  movements: {
    id: string;
    type: string;
    amount: number;
    reason: string | null;
    created_at: string;
  }[];
};

function shortTicketTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** HTML del ticket 58mm (para vista previa e impresión) */
function buildTicket58Html(opts: ArqueoPrintOpts): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const mvHtml =
    opts.movements.length === 0
      ? `<div class="center muted">Sin entradas ni salidas</div>`
      : opts.movements
          .map((m) => {
            const tipo =
              m.type === "deposit" ? "ENTRADA" : "SALIDA";
            const signo = m.type === "deposit" ? "+" : "-";
            const reason = esc(
              (m.reason && m.reason.trim()) || "Sin motivo",
            );
            return `<div class="mv">
  <div class="row"><span class="bold">${tipo}</span><span>${signo}${money(Number(m.amount))}</span></div>
  <div class="muted">${shortTicketTime(m.created_at)}</div>
  <div class="muted">Motivo: ${reason}</div>
</div>`;
          })
          .join("");

  const countedBlock =
    opts.counted != null
      ? `<div class="dash"></div>
<div class="row"><span>Contado</span><span>${money(opts.counted)}</span></div>
<div class="row bold"><span>Diferencia</span><span>${money(Number(opts.difference ?? 0))}</span></div>`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Corte de caja 58mm</title>
  <style>
    @page { size: 58mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 58mm;
      max-width: 58mm;
      background: #fff;
      color: #000;
    }
    body {
      font-family: "Courier New", Courier, ui-monospace, monospace;
      font-size: 11px;
      line-height: 1.25;
      padding: 2mm 2.5mm 4mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .muted { color: #333; font-size: 10px; }
    .title {
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      margin: 0 0 2px;
      text-transform: uppercase;
    }
    .dash {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      margin: 2px 0;
    }
    .row span:last-child {
      white-space: nowrap;
      text-align: right;
    }
    .mv {
      margin: 4px 0 6px;
      padding-bottom: 4px;
      border-bottom: 1px dotted #999;
    }
    .mv:last-child { border-bottom: none; }
    .sec {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      margin: 6px 0 2px;
    }
  </style>
</head>
<body>
  <p class="title">Corte de caja</p>
  <p class="center bold">${esc(opts.branchLabel)}</p>
  <p class="center muted">Lula Shop</p>
  <div class="dash"></div>
  <div class="row"><span>Abierta</span><span>${shortTicketTime(opts.openedAt)}</span></div>
  <div class="row"><span>Responsable</span><span>${esc((opts.openedByName || "—").slice(0, 18))}</span></div>
  ${
    opts.closedAt
      ? `<div class="row"><span>Cerrada</span><span>${shortTicketTime(opts.closedAt)}</span></div>`
      : `<div class="center muted">Corte en curso</div>`
  }
  <div class="dash"></div>
  <div class="sec">Resumen</div>
  <div class="row"><span>Fondo inicial</span><span>${money(opts.opening)}</span></div>
  <div class="row"><span>Ventas efectivo</span><span>+${money(opts.cashSales + opts.mixedCash)}</span></div>
  <div class="row"><span>Entradas</span><span>+${money(opts.deposits)}</span></div>
  <div class="row"><span>Salidas</span><span>-${money(opts.withdrawals)}</span></div>
  <div class="row"><span>Gastos efectivo</span><span>-${money(opts.cashExpenses)}</span></div>
  <div class="dash"></div>
  <div class="row bold"><span>Debe haber</span><span>${money(opts.expected)}</span></div>
  ${countedBlock}
  <div class="dash"></div>
  <div class="sec">Movimientos del dia</div>
  ${mvHtml}
  <div class="dash"></div>
  <p class="center muted">Fin del corte</p>
  <p class="center muted">Ticket 58mm</p>
</body>
</html>`;
}


function buildCorteText(opts: ArqueoPrintOpts): string {
  const moneyFmt = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const lines: string[] = [];
  lines.push("CORTE DE CAJA");
  lines.push(opts.branchLabel);
  lines.push("Lula Shop");
  lines.push("--------------------------------");
  lines.push(`Abierta: ${shortTicketTime(opts.openedAt)}`);
  lines.push(`Responsable: ${(opts.openedByName || "—").slice(0, 18)}`);
  if (opts.closedAt) {
    lines.push(`Cerrada: ${shortTicketTime(opts.closedAt)}`);
  } else {
    lines.push("Corte en curso");
  }
  lines.push("--------------------------------");
  lines.push("RESUMEN");
  lines.push(`Fondo inicial    ${moneyFmt(opts.opening)}`);
  lines.push(`Ventas efectivo  +${moneyFmt(opts.cashSales + opts.mixedCash)}`);
  lines.push(`Entradas         +${moneyFmt(opts.deposits)}`);
  lines.push(`Salidas          -${moneyFmt(opts.withdrawals)}`);
  lines.push(`Gastos efectivo  -${moneyFmt(opts.cashExpenses)}`);
  lines.push("--------------------------------");
  lines.push(`DEBE HABER       ${moneyFmt(opts.expected)}`);
  if (opts.counted != null) {
    lines.push(`Contado          ${moneyFmt(opts.counted)}`);
    lines.push(`Diferencia       ${moneyFmt(Number(opts.difference ?? 0))}`);
  }
  lines.push("--------------------------------");
  lines.push("MOVIMIENTOS");
  if (opts.movements.length === 0) {
    lines.push("Sin entradas ni salidas");
  } else {
    for (const m of opts.movements) {
      const tipo = m.type === "deposit" ? "ENTRADA" : "SALIDA";
      const signo = m.type === "deposit" ? "+" : "-";
      lines.push(`${tipo} ${signo}${moneyFmt(Number(m.amount))}`);
      lines.push(`  ${shortTicketTime(m.created_at)}`);
      lines.push(`  ${(m.reason && m.reason.trim()) || "Sin motivo"}`);
    }
  }
  lines.push("--------------------------------");
  lines.push("Fin del corte");
  lines.push("");
  return lines.join("\n");
}

function printTicket58Html(html: string) {
  // 1) Intentar iframe (mejor en móvil que window.open)
  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute(
      "style",
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;",
    );
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      throw new Error("No se pudo crear el documento de impresión.");
    }
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow;
    if (!win) {
      throw new Error("No se pudo abrir la vista de impresión.");
    }
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // ignore
      }
      setTimeout(() => {
        iframe.remove();
      }, 1500);
    }, 300);
    return;
  } catch {
    // 2) Fallback ventana
  }

  const w = window.open("", "_blank");
  if (!w) {
    toast.error(
      "No se pudo abrir la impresión. Revisa si el navegador bloqueó ventanas emergentes.",
    );
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      // ignore
    }
  }, 300);
}


async function resolveProfileName(userId: string | null | undefined): Promise<string> {
  if (!userId) return "—";
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) return "—";
  const name = (data?.full_name ?? "").trim();
  return name || "—";
}

async function loadSessionPrintData(sessionId: string) {

  const [mvRes, cashRes, mixedRes, expRes] = await Promise.all([
    supabase
      .from("cash_movements")
      .select("id, type, amount, reason, created_at")
      .eq("cash_session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("sales")
      .select("total")
      .eq("cash_session_id", sessionId)
      .eq("payment_method", "cash")
      .in("status", ["completed", "partially_refunded"]),
    supabase
      .from("sales")
      .select("cash_received")
      .eq("cash_session_id", sessionId)
      .eq("payment_method", "mixed")
      .in("status", ["completed", "partially_refunded"]),
    supabase
      .from("expenses")
      .select("amount")
      .eq("cash_session_id", sessionId),
  ]);

  const movements = mvRes.data ?? [];
  const deposits = movements
    .filter((m) => m.type === "deposit")
    .reduce((t, m) => t + Number(m.amount ?? 0), 0);
  const withdrawals = movements
    .filter((m) => m.type === "withdrawal")
    .reduce((t, m) => t + Number(m.amount ?? 0), 0);
  const cashSales = (cashRes.data ?? []).reduce(
    (t, r) => t + Number(r.total ?? 0),
    0,
  );
  const mixedCash = (mixedRes.data ?? []).reduce(
    (t, r) => t + Number(r.cash_received ?? 0),
    0,
  );
  const cashExpenses = (expRes.data ?? []).reduce(
    (t, r) => t + Number(r.amount ?? 0),
    0,
  );

  return {
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      amount: Number(m.amount ?? 0),
      reason: m.reason ?? null,
      created_at: m.created_at,
    })),
    deposits,
    withdrawals,
    cashSales,
    mixedCash,
    cashExpenses,
  };
}

export function CashDrawerPanel({
  className,
}: {
  className?: string;
}) {
  const { branchId, branches } = useBranch();
  const { user } = useAuth();
  const branchLabel =
    branches.find((b) => b.id === branchId)?.name ?? "Sucursal";
  const qc = useQueryClient();

  const [opening, setOpening] = useState(String(DEFAULT_FONDO));
  const [mvType, setMvType] =
    useState<MovementType>("withdrawal");
  const [mvAmount, setMvAmount] = useState("");
  const [mvReason, setMvReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [denomCounts, setDenomCounts] = useState<Record<string, string>>(
    emptyDenomCounts,
  );
  const [printingClosedId, setPrintingClosedId] = useState<string | null>(null);
  const [ticketHtml, setTicketHtml] = useState<string | null>(null);
  const [ticketTitle, setTicketTitle] = useState("Corte de caja");
  const [ticketOpts, setTicketOpts] = useState<ArqueoPrintOpts | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: ["cash-session"],
    });

    void qc.invalidateQueries({
      queryKey: ["cash-session-totals"],
    });

    void qc.invalidateQueries({
      queryKey: ["closed-sessions"],
    });
  };

  const openTicketPreview = (opts: ArqueoPrintOpts, title = "Corte de caja") => {
    const html = buildTicket58Html(opts);
    setTicketTitle(title);
    setTicketOpts(opts);
    setTicketHtml(html);
  };

  const printClosedSession = async (closedSession: {
    id: string;
    opened_at: string;
    closed_at: string | null;
    opened_by?: string | null;
    opening_amount: number;
    expected_amount: number | null;
    closing_amount: number | null;
    difference: number | null;
  }) => {
    try {
      setPrintingClosedId(closedSession.id);
      const [detail, openedByName] = await Promise.all([
        loadSessionPrintData(closedSession.id),
        resolveProfileName(closedSession.opened_by),
      ]);
      openTicketPreview(
        {
          branchLabel,
          openedAt: closedSession.opened_at,
          closedAt: closedSession.closed_at,
          openedByName,
          opening: Number(closedSession.opening_amount ?? 0),
          cashSales: detail.cashSales,
          mixedCash: detail.mixedCash,
          deposits: detail.deposits,
          withdrawals: detail.withdrawals,
          cashExpenses: detail.cashExpenses,
          expected: Number(
            closedSession.expected_amount ??
              Number(closedSession.opening_amount ?? 0) +
                detail.cashSales +
                detail.mixedCash +
                detail.deposits -
                detail.withdrawals -
                detail.cashExpenses,
          ),
          counted:
            closedSession.closing_amount != null
              ? Number(closedSession.closing_amount)
              : null,
          difference:
            closedSession.difference != null
              ? Number(closedSession.difference)
              : null,
          movements: detail.movements,
        },
        "Corte cerrado",
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No se pudo cargar el corte.";
      toast.error(msg);
    } finally {
      setPrintingClosedId(null);
    }
  };


  /*
   * ============================================================
   * CAJA ABIERTA
   * ============================================================
   */

  const {
    data: session,
    isLoading: sessionLoading,
  } = useQuery({
    queryKey: ["cash-session", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .order("opened_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },
  });

  /*
   * ============================================================
   * RESUMEN DE CAJA
   * ============================================================
   */

  const { data: summary } = useQuery({
    queryKey: ["cash-session-totals", session?.id],
    enabled: !!session?.id,
    queryFn: async () => {
      const id = session!.id;

      const [
        cashRes,
        mixedRes,
        mvRes,
        expRes,
      ] = await Promise.all([
        supabase
          .from("sales")
          .select("total")
          .eq("cash_session_id", id)
          .eq("payment_method", "cash")
          .in("status", [
            "completed",
            "partially_refunded",
            "refunded",
          ]),

        supabase
          .from("sales")
          .select("cash_received")
          .eq("cash_session_id", id)
          .eq("payment_method", "mixed")
          .in("status", [
            "completed",
            "partially_refunded",
            "refunded",
          ]),

        supabase
          .from("cash_movements")
          .select(
            "id, type, amount, reason, created_at",
          )
          .eq("cash_session_id", id)
          .order("created_at", {
            ascending: false,
          }),

        supabase
          .from("expenses")
          .select("amount")
          .eq("cash_session_id", id)
          .eq("payment_method", "cash"),
      ]);

      for (const res of [
        cashRes,
        mixedRes,
        mvRes,
        expRes,
      ]) {
        if (res.error) {
          throw res.error;
        }
      }

      const cashSales = (
        cashRes.data ?? []
      ).reduce(
        (total, row) =>
          total + Number(row.total ?? 0),
        0,
      );

      const mixedCash = (
        mixedRes.data ?? []
      ).reduce(
        (total, row) =>
          total + Number(row.cash_received ?? 0),
        0,
      );

      const movements = mvRes.data ?? [];

      const deposits = movements
        .filter(
          (movement) =>
            movement.type === "deposit",
        )
        .reduce(
          (total, movement) =>
            total + Number(movement.amount ?? 0),
          0,
        );

      const withdrawals = movements
        .filter(
          (movement) =>
            movement.type === "withdrawal",
        )
        .reduce(
          (total, movement) =>
            total + Number(movement.amount ?? 0),
          0,
        );

      const cashExpenses = (
        expRes.data ?? []
      ).reduce(
        (total, row) =>
          total + Number(row.amount ?? 0),
        0,
      );

      const expected =
        Number(session!.opening_amount ?? 0) +
        cashSales +
        mixedCash +
        deposits -
        withdrawals -
        cashExpenses;

      return {
        cashSales,
        mixedCash,
        deposits,
        withdrawals,
        cashExpenses,
        movements,
        expected,
      };
    },
  });

  /*
   * ============================================================
   * CAJAS CERRADAS
   * ============================================================
   */

  const {
    data: closedSessions = [],
  } = useQuery({
    queryKey: ["closed-sessions", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "closed")
        .order("closed_at", {
          ascending: false,
        })
        .limit(8);

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  /*
   * ============================================================
   * ABRIR CAJA
   * ============================================================
   */

  const openBox = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error(
          "No hay una sucursal activa.",
        );
      }

      if (!user) {
        throw new Error(
          "Tu sesión no es válida. Vuelve a iniciar sesión.",
        );
      }

      // Fondo fijo de operación: $400 (se puede ajustar si hace falta)
      const amount =
        Number(opening) >= 0 && Number.isFinite(Number(opening))
          ? Number(opening)
          : DEFAULT_FONDO;

      const { error } = await supabase
        .from("cash_sessions")
        .insert({
          branch_id: branchId,
          opened_by: user.id,
          opening_amount: amount,
          status: "open",
        });

      if (error) {
        throw error;
      }
    },

    onSuccess: () => {
      toast.success("Caja abierta correctamente.");

      setOpening(String(DEFAULT_FONDO));

      invalidate();
    },

    onError: (error: Error) => {
      const message =
        getSupabaseErrorMessage(error) ||
        error.message ||
        "No se pudo abrir la caja.";

      toast.error(message);

      invalidate();
    },
  });

  /*
   * ============================================================
   * MOVIMIENTO DE EFECTIVO
   * ============================================================
   */

  const addMovement = useMutation({
    mutationFn: async () => {
      if (!session) {
        throw new Error(
          "La caja está cerrada.",
        );
      }

      if (!user) {
        throw new Error(
          "Tu sesión no es válida.",
        );
      }

      const amount = Number(mvAmount);

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        throw new Error(
          "Escribe una cantidad mayor a 0.",
        );
      }

      const { error } = await supabase
        .from("cash_movements")
        .insert({
          cash_session_id: session.id,
          type: mvType,
          amount,
          reason: mvReason.trim() || null,
          created_by: user.id,
        });

      if (error) {
        throw error;
      }
    },

    onSuccess: () => {
      toast.success(
        "Movimiento registrado.",
      );

      setMvAmount("");
      setMvReason("");

      invalidate();
    },

    onError: (error: Error) => {
      const message =
        getSupabaseErrorMessage(error) ||
        error.message ||
        "No se pudo registrar el movimiento.";

      toast.error(message);
    },
  });

  /*
   * ============================================================
   * CERRAR CAJA
   * ============================================================
   */

  const closeBox = useMutation({
    mutationFn: async () => {
      if (!session) {
        throw new Error(
          "La caja está cerrada.",
        );
      }

      const amount = Number(counted);

      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        throw new Error(
          "Escribe el efectivo contado.",
        );
      }

      const { error } =
        await supabase.rpc(
          "close_cash_session",
          {
            _session_id: session.id,
            _closing_amount: amount,
          },
        );

      if (error) {
        throw error;
      }

      const {
        data: row,
        error: rowErr,
      } = await supabase
        .from("cash_sessions")
        .select(
          "expected_amount, difference",
        )
        .eq("id", session.id)
        .maybeSingle();

      if (rowErr) {
        throw rowErr;
      }

      return row;
    },

    onSuccess: (row) => {
      const diff = Number(
        row?.difference ?? 0,
      );

      const msg =
        Math.abs(diff) < 0.01
          ? "Caja cuadrada, sin diferencia."
          : diff > 0
            ? `Sobran ${money(diff)} en el cajón.`
            : `Faltan ${money(
                Math.abs(diff),
              )} en el cajón.`;

      toast.success(
        `Caja cerrada · ${msg}`,
      );

      setCloseOpen(false);
      setCounted("");

      invalidate();
    },

    onError: (error: Error) => {
      const message =
        getSupabaseErrorMessage(error) ||
        error.message ||
        "No se pudo cerrar la caja.";

      toast.error(message);

      invalidate();
    },
  });

  const expected =
    summary?.expected ?? 0;

  const countedNum =
    Number(counted) || 0;

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <div
      className={cn(
        "min-h-0 max-h-full space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain pb-24 sm:space-y-4 md:pb-4",
        className,
      )}
    >
      {/* ESTADO DE CAJA */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                session
                  ? "bg-[#e8f7ee] text-[#30a46c]"
                  : "bg-[#f1f3f9] text-[#9aa3b8]",
              )}
            >
              {session ? (
                <Unlock className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-[#1a1d26] sm:text-base">
                  {sessionLoading
                    ? "Consultando caja…"
                    : session
                      ? "Caja abierta"
                      : "Caja cerrada"}
                </p>
                {!sessionLoading && (
                  <span
                    className={
                      session
                        ? "rounded-full bg-[#e8f5e9] px-2.5 py-0.5 text-[11px] font-semibold text-[#2e7d32]"
                        : "rounded-full bg-[#eeeeee] px-2.5 py-0.5 text-[11px] font-semibold text-[#757575]"
                    }
                  >
                    {session ? "ABIERTA" : "CERRADA"}
                  </span>
                )}
              </div>

              <p className="mt-0.5 break-words text-xs leading-5 text-[#9aa3b8]">
                {session
                  ? `Abierta el ${dateTime(
                      session.opened_at,
                    )} · inicial ${money(
                      Number(
                        session.opening_amount,
                      ),
                    )}`
                  : "Abre la caja para poder cobrar"}
              </p>
            </div>
          </div>

          {session && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full touch-manipulation rounded-xl border-[#e2e8f0] sm:w-auto"
                onClick={() => {
                  if (!session) return;
                  void (async () => {
                    const openedByName = await resolveProfileName(
                      session.opened_by,
                    );
                    openTicketPreview(
                      {
                        branchLabel,
                        openedAt: session.opened_at,
                        openedByName,
                        opening: Number(session.opening_amount ?? 0),
                        cashSales: summary?.cashSales ?? 0,
                        mixedCash: summary?.mixedCash ?? 0,
                        deposits: summary?.deposits ?? 0,
                        withdrawals: summary?.withdrawals ?? 0,
                        cashExpenses: summary?.cashExpenses ?? 0,
                        expected: summary?.expected ?? 0,
                        movements: (summary?.movements ?? []).map((m) => ({
                          id: m.id,
                          type: m.type,
                          amount: Number(m.amount ?? 0),
                          reason: m.reason ?? null,
                          created_at: m.created_at,
                        })),
                      },
                      "Corte en curso",
                    );
                  })();
                }}
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir corte
              </Button>
              <Button
                variant="outline"
                className="min-h-11 w-full touch-manipulation rounded-xl border-[#e2e8f0] text-[#e5484d] hover:text-[#e5484d] sm:w-auto"
                onClick={() =>
                  setCloseOpen(true)
                }
              >
                <Lock className="mr-2 h-4 w-4" />
                Cerrar caja
              </Button>
            </div>
          )}
        </div>
      </div>

      {!session ? (
        /* ======================================================
         * ABRIR CAJA
         * ====================================================== */
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#1a1d26] sm:text-base">
            <Wallet className="h-4 w-4 shrink-0 text-[#4169e2]" />
            Abrir caja
          </h2>

          <p className="mt-1 text-xs leading-5 text-[#9aa3b8] sm:text-sm">
            El fondo de caja es fijo:{" "}
            <strong className="text-[#1a1d26]">
              {money(DEFAULT_FONDO)}
            </strong>
            . Solo cambia el monto si ese día
            el fondo es distinto.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={opening}
              onChange={(event) =>
                setOpening(
                  event.target.value,
                )
              }
              placeholder={String(DEFAULT_FONDO)}
              className="h-11 w-full rounded-xl border-[#e2e8f0] sm:w-40"
            />

            <Button
              className="min-h-11 w-full touch-manipulation rounded-xl bg-[#4169e2] hover:bg-[#4169e2]/90 sm:w-auto"
              disabled={
                openBox.isPending ||
                sessionLoading
              }
              onClick={() =>
                openBox.mutate()
              }
            >
              {openBox.isPending
                ? "Abriendo…"
                : "Abrir caja"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* ==================================================
           * RESUMEN
           * ================================================== */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3">
            <Stat
              label="Efectivo inicial"
              value={money(
                Number(
                  session.opening_amount,
                ),
              )}
            />

            <Stat
              label="Ventas en efectivo"
              value={money(
                (summary?.cashSales ?? 0) +
                  (summary?.mixedCash ?? 0),
              )}
              hint={
                summary &&
                summary.mixedCash > 0
                  ? `Incluye ${money(
                      summary.mixedCash,
                    )} de pagos mixtos`
                  : undefined
              }
            />

            <Stat
              label="Gastos en efectivo"
              value={`− ${money(
                summary?.cashExpenses ?? 0,
              )}`}
            />

            <Stat
              label="Entradas"
              value={`+ ${money(
                summary?.deposits ?? 0,
              )}`}
            />

            <Stat
              label="Salidas"
              value={`− ${money(
                summary?.withdrawals ?? 0,
              )}`}
            />

            <div className="rounded-2xl border border-[#4169e2]/30 bg-[#eef2fe] p-3.5 sm:p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#4169e2] sm:text-[11px]">
                Debe haber
              </p>

              <p className="mt-1 break-words text-xl font-black text-[#4169e2] sm:text-2xl">
                {money(expected)}
              </p>
            </div>
          </div>

          {/* ==================================================
           * MOVIMIENTOS
           * ================================================== */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
            <h3 className="text-sm font-bold text-[#1a1d26] sm:text-base">
              Movimiento de efectivo
            </h3>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-[auto_9rem_minmax(12rem,1fr)_auto] md:items-center">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={
                    mvType === "deposit"
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    "min-h-11 touch-manipulation rounded-xl",
                    mvType === "deposit" &&
                      "bg-[#30a46c] hover:bg-[#30a46c]/90",
                  )}
                  onClick={() =>
                    setMvType("deposit")
                  }
                >
                  <ArrowUpRight className="mr-1 h-4 w-4" />
                  Entrada
                </Button>

                <Button
                  size="sm"
                  variant={
                    mvType === "withdrawal"
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    "min-h-11 touch-manipulation rounded-xl",
                    mvType ===
                      "withdrawal" &&
                      "bg-[#e5484d] hover:bg-[#e5484d]/90",
                  )}
                  onClick={() =>
                    setMvType(
                      "withdrawal",
                    )
                  }
                >
                  <ArrowDownLeft className="mr-1 h-4 w-4" />
                  Salida
                </Button>
              </div>

              <Input
                type="number"
                min="0"
                step="0.01"
                value={mvAmount}
                onChange={(event) =>
                  setMvAmount(
                    event.target.value,
                  )
                }
                placeholder="Cantidad"
                className="h-11 w-full rounded-xl border-[#e2e8f0]"
              />

              <Input
                value={mvReason}
                onChange={(event) =>
                  setMvReason(
                    event.target.value,
                  )
                }
                placeholder="Motivo (opcional)"
                className="h-11 w-full rounded-xl border-[#e2e8f0]"
              />

              <Button
                size="sm"
                className="min-h-11 w-full touch-manipulation rounded-xl bg-[#4169e2] hover:bg-[#4169e2]/90 md:w-auto"
                disabled={
                  addMovement.isPending
                }
                onClick={() =>
                  addMovement.mutate()
                }
              >
                {addMovement.isPending
                  ? "Guardando…"
                  : "Agregar"}
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_REASONS[mvType].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setMvReason(reason)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                    mvReason === reason
                      ? "border-[#4169e2] bg-[#eef2fe] text-[#4169e2]"
                      : "border-[#e0e0e0] bg-white text-[#616161]",
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>

            <p className="mt-2 text-[11px] leading-4 text-[#9aa3b8]">
              Ejemplo: domicilio no cobrado → <strong>Salida</strong>.
              Dinero de perfumes (otro sistema) → <strong>Entrada</strong>.
            </p>

            <div className="mt-4 space-y-2">
              {(summary?.movements ?? [])
                .length === 0 ? (
                <p className="py-5 text-center text-sm text-[#9aa3b8]">
                  Sin entradas ni salidas
                  registradas
                </p>
              ) : (
                (
                  summary?.movements ?? []
                ).map((movement) => (
                  <div
                    key={movement.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[#f0f0f0] bg-[#fafafa] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            movement.type ===
                              "deposit"
                              ? "bg-[#e8f5e9] text-[#2e7d32]"
                              : "bg-[#ffebee] text-[#c62828]",
                          )}
                        >
                          {movement.type ===
                          "deposit"
                            ? "Entrada"
                            : "Salida"}
                        </span>
                        <p className="break-words text-sm font-medium leading-5 text-[#1a1d26]">
                          {movement.reason ||
                            (movement.type ===
                            "deposit"
                              ? "Entrada de efectivo"
                              : "Salida de efectivo")}
                        </p>
                      </div>

                      <p className="mt-0.5 text-xs text-[#9aa3b8]">
                        {dateTime(
                          movement.created_at,
                        )}
                      </p>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 whitespace-nowrap text-sm font-bold sm:text-base",
                        movement.type ===
                          "deposit"
                          ? "text-[#30a46c]"
                          : "text-[#e5484d]",
                      )}
                    >
                      {movement.type ===
                      "deposit"
                        ? "+"
                        : "−"}{" "}
                      {money(
                        Number(
                          movement.amount,
                        ),
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* ======================================================
       * CERRAR CAJA
       * ====================================================== */}
      <Dialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Cerrar caja — conteo
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <p className="text-sm leading-6 text-muted-foreground">
              Debe haber{" "}
              <span className="font-bold text-foreground">
                {money(expected)}
              </span>
              . Cuenta billetes y monedas; el
              total se calcula solo.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DENOMINATIONS.map((d) => {
                const key = String(d.value);
                const qty = Number(denomCounts[key] || 0);
                const sub =
                  Number.isFinite(qty) && qty > 0
                    ? qty * d.value
                    : 0;
                return (
                  <label
                    key={key}
                    className="rounded-xl border border-[#e8ecf4] bg-[#fafbfe] p-2"
                  >
                    <span className="text-[11px] font-semibold text-[#4169e2]">
                      {d.label}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={denomCounts[key]}
                      onChange={(e) => {
                        const next = {
                          ...denomCounts,
                          [key]: e.target.value,
                        };
                        setDenomCounts(next);
                        setCounted(
                          String(sumDenominations(next)),
                        );
                      }}
                      placeholder="0"
                      className="mt-1 h-9 rounded-lg text-sm"
                    />
                    <span className="mt-0.5 block text-[10px] text-[#9aa3b8]">
                      = {money(sub)}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="rounded-xl border border-[#4169e2]/25 bg-[#eef2fe] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#4169e2]">
                Total contado
              </p>
              <p className="text-2xl font-black text-[#4169e2]">
                {money(countedNum)}
              </p>
            </div>

            <Input
              type="number"
              min="0"
              step="0.01"
              value={counted}
              onChange={(event) =>
                setCounted(event.target.value)
              }
              placeholder="Ajuste manual (opcional)"
              className="h-11 rounded-xl text-sm"
            />
            <p className="text-[11px] text-[#9aa3b8]">
              Si prefieres, puedes corregir el
              total a mano.
            </p>

            {counted !== "" && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-sm font-semibold",
                  Math.abs(countedNum - expected) < 0.01
                    ? "border-[#30a46c]/30 bg-[#e8f7ee]"
                    : countedNum > expected
                      ? "border-[#4169e2]/30 bg-[#eef2fe]"
                      : "border-[#e5484d]/30 bg-[#fff0f0]",
                )}
              >
                <p
                  className={cn(
                    Math.abs(countedNum - expected) < 0.01
                      ? "text-[#30a46c]"
                      : countedNum > expected
                        ? "text-[#4169e2]"
                        : "text-[#e5484d]",
                  )}
                >
                  {Math.abs(countedNum - expected) < 0.01
                    ? "Cuadre exacto"
                    : countedNum > expected
                      ? `Sobran ${money(countedNum - expected)}`
                      : `Faltan ${money(expected - countedNum)}`}
                </p>
                <p className="mt-1 text-[11px] font-normal text-muted-foreground">
                  Esperado {money(expected)} · Contado{" "}
                  {money(countedNum)}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="min-h-11 w-full touch-manipulation rounded-xl sm:w-auto"
              onClick={() =>
                setCloseOpen(false)
              }
              disabled={
                closeBox.isPending
              }
            >
              Cancelar
            </Button>

            <Button
              className="min-h-11 w-full touch-manipulation rounded-xl sm:w-auto"
              disabled={
                closeBox.isPending
              }
              onClick={() =>
                closeBox.mutate()
              }
            >
              {closeBox.isPending
                ? "Cerrando…"
                : "Cerrar caja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ======================================================
       * VISTA PREVIA TICKET 58mm
       * ====================================================== */}
      <Dialog
        open={!!ticketHtml}
        onOpenChange={(open) => {
          if (!open) {
            setTicketHtml(null);
            setTicketOpts(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[92vh] w-[calc(100%-1rem)] max-w-sm flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:w-full">
          <DialogHeader className="border-b px-4 py-3 text-left">
            <DialogTitle className="text-base">
              {ticketTitle}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Vista previa ticket 58 mm · revisa y luego imprime
            </p>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f3f4f6] px-3 py-3">
            {ticketHtml ? (
              <div className="mx-auto w-[58mm] max-w-full overflow-hidden rounded-md border bg-white shadow-sm">
                <iframe
                  title="ticket-58mm"
                  srcDoc={ticketHtml}
                  className="block w-full border-0"
                  style={{ height: "70vh", minHeight: 360 }}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-col gap-2 border-t bg-white px-4 py-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full rounded-xl sm:w-auto"
              onClick={() => {
                setTicketHtml(null);
                setTicketOpts(null);
              }}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full rounded-xl bg-[#4169e2] hover:bg-[#4169e2]/90 sm:w-auto"
              onClick={async () => {
                if (!ticketHtml) return;
                try {
                  if (ticketOpts) {
                    await printTextBluetooth(buildCorteText(ticketOpts));
                    toast.success("Corte enviado a la impresora Bluetooth");
                    return;
                  }
                } catch (e) {
                  console.warn("Bluetooth falló, usando impresión del sistema:", e);
                  toast.message(
                    e instanceof Error
                      ? e.message
                      : "Bluetooth no disponible, abriendo impresión del sistema",
                  );
                }
                printTicket58Html(ticketHtml);
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              Imprimir en térmica
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================
       * ARQUEOS ANTERIORES
       * ====================================================== */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
        <h3 className="text-sm font-bold text-[#1a1d26] sm:text-base">
          Arqueos anteriores
        </h3>

        {closedSessions.length === 0 ? (
          <p className="py-5 text-center text-sm text-[#9aa3b8]">
            Aún no hay cajas cerradas
          </p>
        ) : (
          <>
            {/* CELULAR / TABLET */}
            <div className="mt-3 grid gap-2.5 lg:hidden">
              {closedSessions.map(
                (closedSession) => {
                  const diff = Number(
                    closedSession.difference ??
                      0,
                  );

                  return (
                    <div
                      key={
                        closedSession.id
                      }
                      className="rounded-xl border border-[#eef1f8] bg-[#fafbfe] p-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#9aa3b8]">
                            Cerrada
                          </p>

                          <p className="mt-1 break-words text-sm font-semibold text-[#1a1d26]">
                            {closedSession.closed_at
                              ? dateTime(
                                  closedSession.closed_at,
                                )
                              : "—"}
                          </p>
                        </div>

                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-full text-xs",
                            Math.abs(
                              diff,
                            ) < 0.01
                              ? "border-[#30a46c]/40 bg-[#e8f7ee] text-[#30a46c]"
                              : "border-[#e5484d]/40 bg-[#fff0f0] text-[#e5484d]",
                          )}
                        >
                          {diff > 0
                            ? "+"
                            : ""}
                          {money(diff)}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#eef1f8] pt-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#9aa3b8]">
                            Esperado
                          </p>
                          <p className="mt-1 break-words text-sm font-bold text-[#1a1d26]">
                            {money(
                              Number(
                                closedSession.expected_amount ??
                                  0,
                              ),
                            )}
                          </p>
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#9aa3b8]">
                            Contado
                          </p>
                          <p className="mt-1 break-words text-sm font-bold text-[#1a1d26]">
                            {money(
                              Number(
                                closedSession.closing_amount ??
                                  0,
                              ),
                            )}
                          </p>
                        </div>

                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#9aa3b8]">
                            Diferencia
                          </p>

                          <p
                            className={cn(
                              "mt-1 break-words text-sm font-bold",
                              Math.abs(
                                diff,
                              ) < 0.01
                                ? "text-[#30a46c]"
                                : "text-[#e5484d]",
                            )}
                          >
                            {diff > 0
                              ? "+"
                              : ""}
                            {money(diff)}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 min-h-10 w-full rounded-xl"
                        disabled={printingClosedId === closedSession.id}
                        onClick={() => {
                          void printClosedSession(closedSession);
                        }}
                      >
                        <Printer className="mr-2 h-4 w-4" />
                        {printingClosedId === closedSession.id
                          ? "Preparando…"
                          : "Imprimir corte"}
                      </Button>
                    </div>
                  );
                },
              )}
            </div>

            {/* DESKTOP / PANTALLAS GRANDES */}
            <div className="mt-2 hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#9aa3b8]">
                    <th className="py-2 pr-4 font-semibold">
                      Cerrada
                    </th>

                    <th className="py-2 pr-4 font-semibold">
                      Esperado
                    </th>

                    <th className="py-2 pr-4 font-semibold">
                      Contado
                    </th>

                    <th className="py-2 pr-4 font-semibold">
                      Diferencia
                    </th>

                    <th className="py-2 font-semibold">
                      Corte
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#eef1f8]">
                  {closedSessions.map(
                    (closedSession) => {
                      const diff = Number(
                        closedSession.difference ??
                          0,
                      );

                      return (
                        <tr
                          key={
                            closedSession.id
                          }
                        >
                          <td className="py-2 pr-4 text-[#4b5563]">
                            {closedSession.closed_at
                              ? dateTime(
                                  closedSession.closed_at,
                                )
                              : "—"}
                          </td>

                          <td className="py-2 pr-4">
                            {money(
                              Number(
                                closedSession.expected_amount ??
                                  0,
                              ),
                            )}
                          </td>

                          <td className="py-2 pr-4">
                            {money(
                              Number(
                                closedSession.closing_amount ??
                                  0,
                              ),
                            )}
                          </td>

                          <td className="py-2 pr-4">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                Math.abs(
                                  diff,
                                ) < 0.01
                                  ? "border-[#30a46c]/40 text-[#30a46c]"
                                  : "border-[#e5484d]/40 text-[#e5484d]",
                              )}
                            >
                              {diff > 0
                                ? "+"
                                : ""}
                              {money(diff)}
                            </Badge>
                          </td>
                          <td className="py-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg px-2 text-xs"
                              disabled={
                                printingClosedId === closedSession.id
                              }
                              onClick={() => {
                                void printClosedSession(closedSession);
                              }}
                            >
                              <Printer className="mr-1 h-3.5 w-3.5" />
                              {printingClosedId === closedSession.id
                                ? "…"
                                : "Imprimir"}
                            </Button>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-3.5 sm:p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#9aa3b8] sm:text-[11px]">
        {label}
      </p>

      <p className="mt-1 break-words text-base font-bold text-[#1a1d26] sm:text-lg">
        {value}
      </p>

      {hint && (
        <p className="mt-0.5 break-words text-[10px] leading-4 text-[#9aa3b8] sm:text-[11px]">
          {hint}
        </p>
      )}
    </div>
  );
}