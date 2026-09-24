/**
 * Historial de ventas — LULA OS
 * Ruta: src/routes/_shell.ventas.tsx
 *
 * Lista de tickets de la sucursal activa con filtros por fecha, método de pago
 * y estado, totales del periodo y reimpresión de ticket.
 * El punto de venta está en Caja (/caja).
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Receipt, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TicketModal, type TicketData } from "@/components/pos/TicketModal";

export const Route = createFileRoute("/_shell/ventas")({
  head: () => ({
    meta: [
      { title: "Historial de ventas — Lula OS" },
      {
        name: "description",
        content: "Consulta y reimprime los tickets de tu sucursal.",
      },
      { property: "og:title", content: "Historial de ventas — Lula OS" },
      {
        property: "og:description",
        content: "Todos los tickets de tu sucursal, con filtros y totales.",
      },
    ],
  }),
  component: () => (
    <RequireNavAccess navKey="ventas">
      <VentasPage />
    </RequireNavAccess>
  ),
});

type SaleRow = {
  id: string;
  folio: number;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  customerName: string | null;
};

const ALL = "all";
const dayInput = (d: Date) => d.toISOString().slice(0, 10);

function VentasPage() {
  const { branchId } = useBranch();
  const navigate = useNavigate();

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86400000);

  const [from, setFrom] = useState(dayInput(weekAgo));
  const [to, setTo] = useState(dayInput(today));
  const [method, setMethod] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sales-history", branchId, from, to, method, status],
    enabled: !!branchId,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id, folio, total, payment_method, status, created_at, customer_id, customers(name)",
        )
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(300);

      // Los días se interpretan en la zona horaria del dispositivo.
      if (from) q = q.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) q = q.lte("created_at", new Date(`${to}T23:59:59.999`).toISOString());
      if (method !== ALL) q = q.eq("payment_method", method as "cash" | "card" | "transfer" | "credit" | "mixed");
      if (status !== ALL) q = q.eq("status", status as "completed" | "cancelled" | "refunded" | "partially_refunded");

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((r) => {
        const embedded = (
          r as {
            customers?: { name?: string | null } | { name?: string | null }[] | null;
          }
        ).customers;
        const customerName = Array.isArray(embedded)
          ? (embedded[0]?.name ?? null)
          : (embedded?.name ?? null);
        return {
          id: r.id,
          folio: r.folio,
          total: Number(r.total),
          payment_method: r.payment_method,
          status: r.status,
          created_at: r.created_at,
          customerName,
        } satisfies SaleRow;
      });
    },
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => String(r.folio).includes(q) || (r.customerName ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    const completed = visible.filter((r) => r.status === "completed");
    const sum = completed.reduce((a, r) => a + r.total, 0);
    return {
      tickets: completed.length,
      sum,
      avg: completed.length ? sum / completed.length : 0,
    };
  }, [visible]);

  const reprint = useMutation({
    mutationFn: async (saleId: string) => {
      const { data: sale, error } = await supabase
        .from("sales")
        .select(
          "id, folio, subtotal, tax, discount, total, payment_method, cash_received, change_given, created_at, customer_id, notes",
        )
        .eq("id", saleId)
        .single();
      if (error) throw error;

      const [{ data: items }, { data: customer }] = await Promise.all([
        supabase
          .from("sale_items")
          .select("name_snapshot, quantity, unit_price, discount, total")
          .eq("sale_id", saleId),
        sale.customer_id
          ? supabase.from("customers").select("name").eq("id", sale.customer_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const { data: settings } = await supabase.from("settings").select("key, value");
      const read = (k: string, fallback: string) => {
        const raw = (settings ?? []).find((s) => s.key === k)?.value;
        if (typeof raw === "string") return raw;
        if (raw && typeof raw === "object") return String(raw);
        return fallback;
      };

      return {
        sale,
        items: items ?? [],
        customerName: customer?.name,
        companyName: read("company_name", "Lula Shop"),
        footer: read("ticket_footer", "¡Gracias por su compra!"),
      };
    },
    onSuccess: ({ sale, items, customerName, companyName, footer }) => {
      setTicket({
        companyName,
        branchName: "",
        folio: sale.folio,
        date: new Date(sale.created_at).toLocaleString("es-MX"),
        cashierName: "",
        customerName,
        paymentMethod: sale.payment_method,
        lines: items.map((l) => ({
          name: l.name_snapshot,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          discount: Number(l.discount),
          total: Number(l.total),
        })),
        subtotal: Number(sale.subtotal),
        tax: Number(sale.tax),
        discount: Number(sale.discount),
        total: Number(sale.total),
        cashReceived: sale.cash_received != null ? Number(sale.cash_received) : null,
        changeGiven: sale.change_given != null ? Number(sale.change_given) : null,
        footer,
      });
      setTicketOpen(true);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo abrir el ticket"),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#1a1d26]">Historial de ventas</h1>
          <p className="text-sm text-[#9aa3b8]">
            Tickets de la sucursal activa. Para vender usa la Caja.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl border-[#e2e8f0]"
            onClick={() => navigate({ to: "/devoluciones" })}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Devoluciones
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e2e8f0] bg-white p-3">
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-36 rounded-xl border-[#e2e8f0]"
          />
          <span className="text-xs text-[#9aa3b8]">a</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-36 rounded-xl border-[#e2e8f0]"
          />
        </div>

        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="h-9 w-36 rounded-xl border-[#e2e8f0] text-sm">
            <SelectValue placeholder="Método" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los métodos</SelectItem>
            <SelectItem value="cash">Efectivo</SelectItem>
            <SelectItem value="card">Tarjeta</SelectItem>
            <SelectItem value="transfer">Transferencia</SelectItem>
            <SelectItem value="credit">Crédito</SelectItem>
            <SelectItem value="mixed">Mixto</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-40 rounded-xl border-[#e2e8f0] text-sm">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="completed">Completada</SelectItem>
            <SelectItem value="cancelled">Cancelada</SelectItem>
            <SelectItem value="refunded">Reembolsada</SelectItem>
            <SelectItem value="partially_refunded">Parcial</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3b8]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar folio o cliente"
            className="h-9 rounded-xl border-[#e2e8f0] pl-9"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="rounded-xl border-[#e2e8f0]"
          onClick={() => {
            setFrom(dayInput(weekAgo));
            setTo(dayInput(today));
            setMethod(ALL);
            setStatus(ALL);
            setQuery("");
          }}
        >
          Recargar
        </Button>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-3 gap-3">
        <Card label="Tickets" value={String(totals.tickets)} />
        <Card label="Ventas del periodo" value={money(totals.sum)} />
        <Card label="Ticket promedio" value={money(totals.avg)} />
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-[#9aa3b8]">Cargando…</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-[#9aa3b8]">
            <Receipt className="h-9 w-9 opacity-30" />
            <p className="text-sm">Sin tickets en este filtro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f8fafd] text-left text-xs text-[#9aa3b8]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Folio</th>
                  <th className="px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 font-semibold">Método</th>
                  <th className="px-4 py-2.5 font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f8]">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-[#fafbfe]">
                    <td className="px-4 py-2.5 font-bold text-[#1a1d26]">#{r.folio}</td>
                    <td className="px-4 py-2.5 text-[#4b5563]">
                      {new Date(r.created_at).toLocaleString("es-MX")}
                    </td>
                    <td className="px-4 py-2.5 text-[#4b5563]">{r.customerName || "Mostrador"}</td>
                    <td className="px-4 py-2.5 capitalize text-[#4b5563]">{r.payment_method}</td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          r.status === "completed"
                            ? "border-[#30a46c]/40 text-[#30a46c]"
                            : r.status === "cancelled"
                              ? "border-[#e5484d]/40 text-[#e5484d]"
                              : "border-[#f5a623]/50 text-[#b47707]",
                        )}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#1a1d26]">
                      {money(r.total)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg border-[#e2e8f0]"
                        disabled={reprint.isPending}
                        onClick={() => reprint.mutate(r.id)}
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" />
                        Ticket
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TicketModal open={ticketOpen} onOpenChange={setTicketOpen} ticket={ticket} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#9aa3b8]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#1a1d26]">{value}</p>
    </div>
  );
}
