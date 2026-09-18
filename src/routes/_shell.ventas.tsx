/**
 * Punto de venta profesional — FASE 1 + FASE 2
 * Ruta: src/routes/_shell.ventas.tsx
 * Reemplaza el archivo existente.
 *
 * Incluye:
 * - Exige caja abierta (setting)
 * - Bloqueo sin stock
 * - Descuento por ticket y por línea
 * - Folio devuelto por RPC
 * - Ticket imprimible
 * - Crédito / métodos de pago
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, AlertTriangle, Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      { title: "Punto de venta — Lula Shop OS" },
      {
        name: "description",
        content: "Cobra rápido: busca productos, arma el carrito y registra la venta con descuento de inventario.",
      },
      { property: "og:title", content: "Punto de venta — Lula Shop OS" },
    ],
  }),
  component: VentasPage,
});

type CartLine = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  discount: number;
  tax_rate: number;
  stock?: number;
};

type PaymentMethod = "cash" | "card" | "transfer" | "credit" | "mixed";

function VentasPage() {
  const { branchId, branches } = useBranch();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerId, setCustomerId] = useState<string>("none");
  const [cashReceived, setCashReceived] = useState("");
  const [ticketDiscount, setTicketDiscount] = useState("0");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);

  const branchName = branches.find((b) => b.id === branchId)?.name;

  const { data: settings } = useQuery({
    queryKey: ["settings-pos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("key, value");
      if (error) throw error;
      const map: Record<string, unknown> = {};
      for (const row of data ?? []) {
        const v = row.value;
        map[row.key] = typeof v === "object" && v !== null && !Array.isArray(v) ? v : v;
      }
      // value suele venir como jsonb escalar o string
      const parse = (k: string, fallback: unknown) => {
        const raw = (data ?? []).find((r) => r.key === k)?.value;
        if (raw === null || raw === undefined) return fallback;
        if (typeof raw === "boolean" || typeof raw === "number") return raw;
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        // jsonb already parsed by supabase client
        return raw as unknown;
      };
      return {
        requireOpenCash: Boolean(parse("require_open_cash_session", true)),
        blockWithoutStock: Boolean(parse("block_sale_without_stock", true)),
        companyName: String(parse("company_name", "Lula Shop")),
        ticketFooter: String(parse("ticket_footer", "¡Gracias por su compra!")),
      };
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["pos-products", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: prods, error } = await supabase
        .from("products")
        .select("id, name, sku, 
... 