import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_shell/caja")({
  head: () => ({
    meta: [
      { title: "Caja — Lula Shop OS" },
      { name: "description", content: "Apertura y cierre de caja, retiros e ingresos, y arqueo por sesión." },
      { property: "og:title", content: "Caja — Lula Shop OS" },
      { property: "og:description", content: "Apertura y cierre de caja, retiros e ingresos, y arqueo por sesión." },
    ],
  }),
  component: CajaPage,
});

type CashSession = {
  id: string;
  branch_id: string;
  opened_by: string;
  closed_by: string | null;
  opening_amount: number;
  closing_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
};

type CashMovement = {
  id: string;
  type: "deposit" | "withdrawal";
  amount: number;
  reason: string | null;
  created_at: string;
};

function CajaPage() {
  const { user, isManager } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [openingAmount, setOpeningAmount] = useState("0");
  const [closingAmount, setClosingAmount] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveType, setMoveType] = useState<"deposit" | "withdrawal">("deposit");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const { data: session, isLoading: loadingSession } = useQuery({
    queryKey: ["open-cash-session", branchId],
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
      return data as CashSession | null;
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["cash-movements", session?.id],
    enabled: !!session?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_movements")
        .select("id, type, amount, reason, created_at")
        .eq("cash_session_id", session!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CashMovement[];
    },
  });

  const { data: cashSalesTotal = 0 } = useQuery({
    queryKey: ["session-cash-sales", session?.id],
    enabled: !!session?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("total")
        .eq("cash_session_id", session!.id)
        .eq("payment_method", "cash")
        .eq("status", "completed");
      if (error) throw error;
      return (data ?? []).reduce((s, r) => s + Number(r.total), 0);
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["cash-sessions-history", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as CashSession[];
    },
  });

  const deposits = useMemo(
    () => movements.filter((m) => m.type === "deposit").reduce((s, m) => s + Number(m.amount), 0),
    [movements],
  );
  const withdrawals = useMemo(
    () => movements.filter((m) => m.type === "withdrawal").reduce((s, m) => s + Number(m.amount), 0),
    [movements],
  );
  const expectedNow = (session?.opening_amount ?? 0) + cashSalesTotal + deposits - withdrawals;

  const openSession = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Selecciona una sucursal");
      const { error } = await supabase.from("cash_sessions").insert({
        branch_id: branchId,
        opened_by: user!.id,
        opening_amount: Number(openingAmount) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caja abierta");
      setOpeningAmount("0");
      void qc.invalidateQueries({ queryKey: ["open-cash-session"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo abrir la caja"),
  });

  const addMovement = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("No hay caja abierta");
      const amount = Number(moveAmount);
      if (!amount || amount <= 0) throw new Error("Monto inválido");
      const { error } = await supabase.from("cash_movements").insert({
        cash_session_id: session.id,
        type: moveType,
        amount,
        reason: moveReason || null,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(moveType === "deposit" ? "Ingreso registrado" : "Retiro registrado");
      setMoveOpen(false);
      setMoveAmount("");
      setMoveReason("");
      void qc.invalidateQueries({ queryKey: ["cash-movements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo registrar"),
  });

  const closeSession = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("No hay caja abierta");
      const { data, error } = await supabase.rpc("close_cash_session", {
        _session_id: session.id,
        _closing_amount: Number(closingAmount) || 0,
      });
      if (error) throw error;
      return data as unknown as CashSession;
    },
    onSuccess: (closed) => {
      const diff = Number(closed.difference ?? 0);
      if (Math.abs(diff) < 0.01) toast.success("Caja cerrada sin diferencias");
      else toast.warning(`Caja cerrada con diferencia de ${money(diff)}`);
      setClosingAmount("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo cerrar la caja"),
  });

  if (!branchId) {
    return <p className="text-sm text-muted-foreground">Selecciona una sucursal para ver su caja.</p>;
  }

  if (loadingSession) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {session ? <Unlock className="size-4 text-green-600" /> : <Lock className="size-4 text-muted-foreground" />}
            {session ? "Caja abierta" : "Caja cerrada"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!session && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Fondo de apertura</Label>
                <Input type="number" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} />
              </div>
              <Button className="w-full" disabled={openSession.isPending} onClick={() => openSession.mutate()}>
                Abrir caja
              </Button>
            </div>
          )}

          {session && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Apertura</div>
                  <div className="font-medium">{money(session.opening_amount)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Ventas en efectivo</div>
                  <div className="font-medium">{money(cashSalesTotal)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Ingresos</div>
                  <div className="font-medium text-green-600">{money(deposits)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Retiros</div>
                  <div className="font-medium text-red-600">{money(withdrawals)}</div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                <span className="text-sm text-muted-foreground">Esperado en caja</span>
                <span className="font-semibold">{money(expectedNow)}</span>
              </div>

              <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!isManager && session.opened_by !== user?.id}
                  >
                    Registrar ingreso o retiro
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Movimiento de caja</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Select value={moveType} onValueChange={(v) => setMoveType(v as "deposit" | "withdrawal")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deposit">Ingreso</SelectItem>
                          <SelectItem value="withdrawal">Retiro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Monto</Label>
                      <Input type="number" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Motivo (opcional)</Label>
                      <Input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button disabled={addMovement.isPending} onClick={() => addMovement.mutate()}>
                      Guardar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {!!movements.length && (
                <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {movements.map((m) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        {m.type === "deposit" ? (
                          <ArrowUpCircle className="size-3.5 text-green-600" />
                        ) : (
                          <ArrowDownCircle className="size-3.5 text-red-600" />
                        )}
                        {m.reason || (m.type === "deposit" ? "Ingreso" : "Retiro")}
                      </span>
                      <span>{money(m.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 border-t pt-3">
                <Label>Efectivo contado para cerrar</Label>
                <Input type="number" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} />
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={closeSession.isPending || (!isManager && session.opened_by !== user?.id)}
                  onClick={() => closeSession.mutate()}
                >
                  Cerrar caja
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de cortes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cierre</TableHead>
                <TableHead>Apertura</TableHead>
                <TableHead>Contado</TableHead>
                <TableHead>Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="text-sm">{shortDate(h.closed_at)}</TableCell>
                  <TableCell>{money(h.opening_amount)}</TableCell>
                  <TableCell>{money(h.closing_amount)}</TableCell>
                  <TableCell>
                    <Badge variant={Math.abs(Number(h.difference ?? 0)) < 0.01 ? "secondary" : "destructive"}>
                      {money(h.difference)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!history.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Sin cortes registrados todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}