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

function printArqueoReport(opts: {
  branchLabel: string;
  openedAt: string;
  opening: number;
  cashSales: number;
  mixedCash: number;
  deposits: number;
  withdrawals: number;
  cashExpenses: number;
  expected: number;
  movements: {
    id: string;
    type: string;
    amount: number;
    reason: string | null;
    created_at: string;
  }[];
}) {
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) {
    toast.error("El navegador bloqueó la impresión.");
    return;
  }

  const mvRows = opts.movements
    .map((m) => {
      const tipo = m.type === "deposit" ? "ENTRADA" : "SALIDA";
      const signo = m.type === "deposit" ? "+" : "−";
      return `<tr>
        <td>${dateTime(m.created_at)}</td>
        <td>${tipo}</td>
        <td>${(m.reason || "—").replace(/</g, "&lt;")}</td>
        <td style="text-align:right">${signo}${money(Number(m.amount))}</td>
      </tr>`;
    })
    .join("");

  w.document.write(`<!DOCTYPE html>
<html><head><title>Arqueo de caja</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;margin:16px;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  .muted{color:#666;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;color:#555}
  .row{display:flex;justify-content:space-between;margin:4px 0}
  .big{font-size:16px;font-weight:700}
  .box{border:1px solid #ccc;border-radius:8px;padding:10px;margin:12px 0}
  @media print{body{margin:8px}}
</style></head><body>
  <h1>Arqueo de caja</h1>
  <p class="muted">${opts.branchLabel}</p>
  <p class="muted">Abierta: ${dateTime(opts.openedAt)}</p>
  <div class="box">
    <div class="row"><span>Fondo inicial</span><span>${money(opts.opening)}</span></div>
    <div class="row"><span>Ventas en efectivo</span><span>+ ${money(opts.cashSales + opts.mixedCash)}</span></div>
    <div class="row"><span>Entradas manuales</span><span>+ ${money(opts.deposits)}</span></div>
    <div class="row"><span>Salidas manuales</span><span>− ${money(opts.withdrawals)}</span></div>
    <div class="row"><span>Gastos en efectivo</span><span>− ${money(opts.cashExpenses)}</span></div>
    <div class="row big"><span>Debe haber en cajón</span><span>${money(opts.expected)}</span></div>
  </div>
  <h2 style="font-size:14px;margin:16px 0 0">Movimientos</h2>
  ${
    opts.movements.length === 0
      ? '<p class="muted">Sin entradas ni salidas manuales</p>'
      : `<table><thead><tr><th>Hora</th><th>Tipo</th><th>Motivo</th><th style="text-align:right">Monto</th></tr></thead><tbody>${mvRows}</tbody></table>`
  }
  <p class="muted" style="margin-top:16px">Documento de entrega de corte — Lula Shop</p>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}</script>
</body></html>`);
  w.document.close();
}

function getSupabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const e = error as {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  };

  if (e.code === "23505") {
    return "Ya existe una caja abierta para esta sucursal. Cierra la caja actual antes de abrir otra.";
  }

  return e.message || e.details || e.hint || "";
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

  const [opening, setOpening] = useState("");
  const [mvType, setMvType] =
    useState<MovementType>("withdrawal");
  const [mvAmount, setMvAmount] = useState("");
  const [mvReason, setMvReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState("");

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

      const amount = Number(opening);

      if (
        !Number.isFinite(amount) ||
        amount < 0
      ) {
        throw new Error(
          "El efectivo inicial debe ser 0 o mayor.",
        );
      }

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

      setOpening("");

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
                  printArqueoReport({
                    branchLabel,
                    openedAt: session.opened_at,
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
                  });
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
            ¿Con cuánto efectivo arranca el
            cajón? Puedes dejarlo en 0.
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
              placeholder="0.00"
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
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-2xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Cerrar caja
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <p className="text-sm leading-6 text-muted-foreground">
              Debería haber{" "}
              <span className="font-bold text-foreground">
                {money(expected)}
              </span>
              . Escribe el efectivo que
              contaste en el cajón.
            </p>

            <Input
              type="number"
              min="0"
              step="0.01"
              value={counted}
              onChange={(event) =>
                setCounted(
                  event.target.value,
                )
              }
              placeholder="0.00"
              className="h-12 rounded-xl text-base"
            />

            {counted !== "" && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-sm font-semibold",
                  Math.abs(
                    countedNum - expected,
                  ) < 0.01
                    ? "border-[#30a46c]/30 bg-[#e8f7ee]"
                    : countedNum >
                        expected
                      ? "border-[#4169e2]/30 bg-[#eef2fe]"
                      : "border-[#e5484d]/30 bg-[#fff0f0]",
                )}
              >
                <p
                  className={cn(
                    Math.abs(
                      countedNum -
                        expected,
                    ) < 0.01
                      ? "text-[#30a46c]"
                      : countedNum >
                          expected
                        ? "text-[#4169e2]"
                        : "text-[#e5484d]",
                  )}
                >
                  {Math.abs(
                    countedNum - expected,
                  ) < 0.01
                    ? "Cuadre exacto"
                    : countedNum >
                        expected
                      ? `Sobran ${money(
                          countedNum -
                            expected,
                        )}`
                      : `Faltan ${money(
                          expected -
                            countedNum,
                        )}`}
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

                    <th className="py-2 font-semibold">
                      Diferencia
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

                          <td className="py-2">
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