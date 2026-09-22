import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/PageHeader";

export const Route = createFileRoute("/_shell/caja")({
  head: () => ({
    meta: [
      { title: "Caja — Lula Shop OS" },
      { name: "description", content: "Abre y cierra caja, registra retiros e ingresos de efectivo y revisa las diferencias del turno." },
      { property: "og:title", content: "Caja — Lula Shop OS" },
      { property: "og:description", content: "Abre y cierra caja, registra retiros e ingresos de efectivo y revisa las diferencias del turno." },
    ],
  }),
  component: CajaPage,
});

function CajaPage() {
  const { user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("");
  const [movType, setMovType] = useState<"deposit" | "withdrawal">("withdrawal");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const { data: open } = useQuery({
    queryKey: ["open-session", branchId],
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

  const { data: movements = [] } = useQuery({
    queryKey: ["cash-movements", open?.id],
    enabled: !!open?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("cash_session_id", open!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["cash-history", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", branchId!)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const openSession = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Selecciona una sucursal");
      const { error } = await supabase.from("cash_sessions").insert({
        branch_id: branchId,
        opened_by: user!.id,
        opening_amount: Number(opening),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caja abierta");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo abrir"),
  });

  const closeSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_cash_session", {
        _session_id: open!.id,
        _closing_amount: Number(closing),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caja cerrada");
      setClosing("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo cerrar"),
  });

  const addMovement = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cash_movements").insert({
        cash_session_id: open!.id,
        type: movType,
        amount: Number(amount),
        reason: reason || null,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimiento registrado");
      setAmount("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["cash-movements"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo registrar"),
  });

  return (
    <PageShell>
      <PageHeader
        icon={Wallet}
        title="Hoy / Caja"
        description="Abre y cierra caja, registra retiros e ingresos de efectivo."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{open ? "Caja abierta" : "Caja cerrada"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {open ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Abierta el {shortDate(open.opened_at)} con {money(open.opening_amount)}
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label>Efectivo contado al cierre</Label>
                    <Input type="number" value={closing} onChange={(e) => setClosing(e.target.value)} />
                  </div>
                  <Button disabled={!closing} onClick={() => closeSession.mutate()}>
                    Cerrar caja
                  </Button>
                </div>
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label>Fondo inicial</Label>
                  <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
                </div>
                <Button onClick={() => openSession.mutate()}>Abrir caja</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cierres anteriores</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cierre</TableHead>
                  <TableHead>Esperado</TableHead>
                  <TableHead>Contado</TableHead>
                  <TableHead>Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{shortDate(s.closed_at)}</TableCell>
                    <TableCell>{money(s.expected_amount)}</TableCell>
                    <TableCell>{money(s.closing_amount)}</TableCell>
                    <TableCell className={Number(s.difference) < 0 ? "text-destructive" : ""}>
                      {money(s.difference)}
                    </TableCell>
                  </TableRow>
                ))}
                {!history.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Sin cierres registrados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Entradas y salidas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!open && <p className="text-sm text-muted-foreground">Abre la caja para registrar movimientos.</p>}
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={movType} onValueChange={(v) => setMovType(v as "deposit" | "withdrawal")}>
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
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button className="w-full" disabled={!open || !amount} onClick={() => addMovement.mutate()}>
            Registrar
          </Button>

          <ul className="space-y-1 border-t pt-3 text-sm">
            {movements.map((m) => (
              <li key={m.id} className="flex justify-between">
                <span className="text-muted-foreground">
                  {m.type === "deposit" ? "Ingreso" : "Retiro"} · {m.reason ?? "sin motivo"}
                </span>
                <span>{money(m.amount)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
    </PageShell>
  );
}
