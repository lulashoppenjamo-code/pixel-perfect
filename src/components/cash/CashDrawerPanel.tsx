/**
 * Arqueo de caja — LULA OS
 * Componente: src/components/cash/CashDrawerPanel.tsx (pestaña «Arqueo» de Caja)
 *
 * Abre y cierra la sesión de caja de la sucursal activa, registra entradas y
 * salidas de dinero y muestra cuánto debe haber en el cajón.
 *
 * El «esperado» replica la fórmula de close_cash_session en la base de datos:
 *   inicial + ventas en efectivo + parte en efectivo de pagos mixtos
 *   + entradas − salidas − gastos pagados en efectivo
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, Wallet } from "lucide-react";
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

const dateTime = (iso: string) => new Date(iso).toLocaleString("es-MX");

export function CashDrawerPanel({ className }: { className?: string }) {
  const { branchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [opening, setOpening] = useState("");
  const [mvType, setMvType] = useState<MovementType>("withdrawal");
  const [mvAmount, setMvAmount] = useState("");
  const [mvReason, setMvReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["cash-session"] });
    void qc.invalidateQueries({ queryKey: ["cash-session-totals"] });
    void qc.invalidateQueries({ queryKey: ["closed-sessions"] });
  };

  const { data: session } = useQuery({
    queryKey: ["cash-session", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["cash-session-totals", session?.id],
    enabled: !!session?.id,
    queryFn: async () => {
      const id = session!.id;
      const [cashRes, mixedRes, mvRes, expRes] = await Promise.all([
        supabase
          .from("sales")
          .select("total")
          .eq("cash_session_id", id)
          .eq("payment_method", "cash")
          .eq("status", "completed"),
        supabase
          .from("sales")
          .select("cash_received")
          .eq("cash_session_id", id)
          .eq("payment_method", "mixed")
          .eq("status", "completed"),
        supabase
          .from("cash_movements")
          .select("id, type, amount, reason, created_at")
          .eq("cash_session_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("expenses")
          .select("amount")
          .eq("cash_session_id", id)
          .eq("payment_method", "cash"),
      ]);
      for (const res of [cashRes, mixedRes, mvRes, expRes]) if (res.error) throw res.error;

      const cashSales = (cashRes.data ?? []).reduce((a, r) => a + Number(r.total), 0);
      const mixedCash = (mixedRes.data ?? []).reduce((a, r) => a + Number(r.cash_received ?? 0), 0);
      const movements = mvRes.data ?? [];
      const deposits = movements
        .filter((m) => m.type === "deposit")
        .reduce((a, m) => a + Number(m.amount), 0);
      const withdrawals = movements
        .filter((m) => m.type === "withdrawal")
        .reduce((a, m) => a + Number(m.amount), 0);
      const cashExpenses = (expRes.data ?? []).reduce((a, r) => a + Number(r.amount), 0);
      const expected =
        Number(session!.opening_amount) + cashSales + mixedCash + deposits - withdrawals - cashExpenses;

      return { cashSales, mixedCash, deposits, withdrawals, cashExpenses, movements, expected };
    },
  });

  const { data: closedSessions = [] } = useQuery({
    queryKey: ["closed-sessions", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  const openBox = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Elige una sucursal");
      if (!user) throw new Error("Sesión no válida");
      const { error } = await supabase.from("cash_sessions").insert({
        branch_id: branchId,
        opened_by: user.id,
        opening_amount: Number(opening) || 0,
        status: "open",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caja abierta");
      setOpening("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo abrir la caja"),
  });

  const addMovement = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("La caja está cerrada");
      if (!user) throw new Error("Sesión no válida");
      const amount = Number(mvAmount);
      if (!amount || amount <= 0) throw new Error("Escribe una cantidad mayor a 0");
      const { error } = await supabase.from("cash_movements").insert({
        cash_session_id: session.id,
        type: mvType,
        amount,
        reason: mvReason.trim() || null,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimiento registrado");
      setMvAmount("");
      setMvReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar el movimiento"),
  });

  const closeBox = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("La caja está cerrada");
      const amount = Number(counted);
      if (Number.isNaN(amount) || amount < 0) throw new Error("Escribe el efectivo contado");
      const { error } = await supabase.rpc("close_cash_session", {
        _session_id: session.id,
        _closing_amount: amount,
      });
      if (error) throw error;
      const { data: row, error: rowErr } = await supabase
        .from("cash_sessions")
        .select("expected_amount, difference")
        .eq("id", session.id)
        .maybeSingle();
      if (rowErr) throw rowErr;
      return row;
    },
    onSuccess: (row) => {
      const diff = Number(row?.difference ?? 0);
      const msg =
        Math.abs(diff) < 0.01
          ? "Caja cuadrada, sin diferencia"
          : diff > 0
            ? `Sobran ${money(diff)} en el cajón`
            : `Faltan ${money(Math.abs(diff))} en el cajón`;
      toast.success(`Caja cerrada · ${msg}`);
      setCloseOpen(false);
      setCounted("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cerrar la caja"),
  });

  const expected = summary?.expected ?? 0;
  const countedNum = Number(counted) || 0;

  return (
    <div className={cn("space-y-4 overflow-y-auto pb-2", className)}>
      {/* Estado de la caja */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-2xl",
              session ? "bg-[#e8f7ee] text-[#30a46c]" : "bg-[#f1f3f9] text-[#9aa3b8]",
            )}
          >
            {session ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-bold text-[#1a1d26]">
              {session ? "Caja abierta" : "Caja cerrada"}
            </p>
            <p className="text-xs text-[#9aa3b8]">
              {session
                ? `Abierta el ${dateTime(session.opened_at)} · inicial ${money(
                    Number(session.opening_amount),
                  )}`
                : "Abre la caja para poder cobrar"}
            </p>
          </div>
        </div>
        {session && (
          <Button
            variant="outline"
            className="rounded-xl border-[#e2e8f0] text-[#e5484d] hover:text-[#e5484d]"
            onClick={() => setCloseOpen(true)}
          >
            <Lock className="mr-2 h-4 w-4" />
            Cerrar caja
          </Button>
        )}
      </div>

      {!session ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[#1a1d26]">
            <Wallet className="h-4 w-4 text-[#4169e2]" />
            Abrir caja
          </h2>
          <p className="mt-1 text-xs text-[#9aa3b8]">
            ¿Con cuánto efectivo arranca el cajón? Puedes dejarlo en 0.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="0.00"
              className="h-10 w-40 rounded-xl border-[#e2e8f0]"
            />
            <Button
              className="rounded-xl bg-[#4169e2] hover:bg-[#4169e2]/90"
              disabled={openBox.isPending}
              onClick={() => openBox.mutate()}
            >
              {openBox.isPending ? "Abriendo…" : "Abrir caja"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Cuadre */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Efectivo inicial" value={money(Number(session.opening_amount))} />
            <Stat
              label="Ventas en efectivo"
              value={money((summary?.cashSales ?? 0) + (summary?.mixedCash ?? 0))}
              hint={
                summary && summary.mixedCash > 0
                  ? `Incluye ${money(summary.mixedCash)} de pagos mixtos`
                  : undefined
              }
            />
            <Stat label="Gastos en efectivo" value={`− ${money(summary?.cashExpenses ?? 0)}`} />
            <Stat label="Entradas" value={`+ ${money(summary?.deposits ?? 0)}`} />
            <Stat label="Salidas" value={`− ${money(summary?.withdrawals ?? 0)}`} />
            <div className="rounded-2xl border border-[#4169e2]/30 bg-[#eef2fe] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#4169e2]">
                Debe haber
              </p>
              <p className="mt-1 text-2xl font-black text-[#4169e2]">{money(expected)}</p>
            </div>
          </div>

          {/* Registrar movimiento */}
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
            <h3 className="text-sm font-bold text-[#1a1d26]">Movimiento de efectivo</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={mvType === "deposit" ? "default" : "outline"}
                  className={cn(
                    "rounded-xl",
                    mvType === "deposit" && "bg-[#30a46c] hover:bg-[#30a46c]/90",
                  )}
                  onClick={() => setMvType("deposit")}
                >
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                  Entrada
                </Button>
                <Button
                  size="sm"
                  variant={mvType === "withdrawal" ? "default" : "outline"}
                  className={cn(
                    "rounded-xl",
                    mvType === "withdrawal" && "bg-[#e5484d] hover:bg-[#e5484d]/90",
                  )}
                  onClick={() => setMvType("withdrawal")}
                >
                  <ArrowDownLeft className="mr-1 h-3.5 w-3.5" />
                  Salida
                </Button>
              </div>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={mvAmount}
                onChange={(e) => setMvAmount(e.target.value)}
                placeholder="Cantidad"
                className="h-9 w-32 rounded-xl border-[#e2e8f0]"
              />
              <Input
                value={mvReason}
                onChange={(e) => setMvReason(e.target.value)}
                placeholder="Motivo (opcional)"
                className="h-9 w-56 rounded-xl border-[#e2e8f0]"
              />
              <Button
                size="sm"
                className="rounded-xl bg-[#4169e2] hover:bg-[#4169e2]/90"
                disabled={addMovement.isPending}
                onClick={() => addMovement.mutate()}
              >
                Agregar
              </Button>
            </div>

            <div className="mt-4 divide-y divide-[#eef1f8]">
              {(summary?.movements ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-[#9aa3b8]">
                  Sin entradas ni salidas registradas
                </p>
              ) : (
                (summary?.movements ?? []).map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#1a1d26]">
                        {m.reason || (m.type === "deposit" ? "Entrada de efectivo" : "Salida de efectivo")}
                      </p>
                      <p className="text-xs text-[#9aa3b8]">{dateTime(m.created_at)}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-bold",
                        m.type === "deposit" ? "text-[#30a46c]" : "text-[#e5484d]",
                      )}
                    >
                      {m.type === "deposit" ? "+" : "−"} {money(Number(m.amount))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Cierre de caja */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Debería haber <span className="font-bold text-foreground">{money(expected)}</span>.
              Escribe el efectivo que contaste en el cajón.
            </p>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
            />
            {counted !== "" && (
              <p
                className={cn(
                  "text-sm font-semibold",
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
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={closeBox.isPending} onClick={() => closeBox.mutate()}>
              {closeBox.isPending ? "Cerrando…" : "Cerrar caja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arqueos anteriores */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
        <h3 className="text-sm font-bold text-[#1a1d26]">Arqueos anteriores</h3>
        {closedSessions.length === 0 ? (
          <p className="py-4 text-center text-sm text-[#9aa3b8]">Aún no hay cajas cerradas</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#9aa3b8]">
                  <th className="py-2 font-semibold">Cerrada</th>
                  <th className="py-2 font-semibold">Esperado</th>
                  <th className="py-2 font-semibold">Contado</th>
                  <th className="py-2 font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f8]">
                {closedSessions.map((s) => {
                  const diff = Number(s.difference ?? 0);
                  return (
                    <tr key={s.id}>
                      <td className="py-2 text-[#4b5563]">
                        {s.closed_at ? dateTime(s.closed_at) : "—"}
                      </td>
                      <td className="py-2">{money(Number(s.expected_amount ?? 0))}</td>
                      <td className="py-2">{money(Number(s.closing_amount ?? 0))}</td>
                      <td className="py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            Math.abs(diff) < 0.01
                              ? "border-[#30a46c]/40 text-[#30a46c]"
                              : "border-[#e5484d]/40 text-[#e5484d]",
                          )}
                        >
                          {diff > 0 ? "+" : ""}
                          {money(diff)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#9aa3b8]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#1a1d26]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[#9aa3b8]">{hint}</p>}
    </div>
  );
}
