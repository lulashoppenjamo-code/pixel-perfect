/**
 * Devoluciones / cancelaciones — FASE 2
 * Ruta: src/routes/_shell.devoluciones.tsx
 * Archivo NUEVO. Tras agregarlo, regenera routeTree (npm run dev o el plugin de TanStack).
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_shell/devoluciones")({
  head: () => ({
    meta: [
      { title: "Devoluciones — Lula Shop OS" },
      { name: "description", content: "Devoluciones totales o parciales de ventas." },
    ],
  }),
  component: DevolucionesPage,
});

type SaleRow = {
  id: string;
  folio: number;
  total: number;
  status: string;
  payment_method: string;
  created_at: string;
  customer_id: string | null;
};

type SaleItem = {
  id: string;
  product_id: string | null;
  name_snapshot: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
};

function DevolucionesPage() {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [folioSearch, setFolioSearch] = useState("");
  const [selected, setSelected] = useState<SaleRow | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [reason, setReason] = useState("");
  const [partialQty, setPartialQty] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<"total" | "partial">("total");

  const { data: sales = [], isLoading } = useQuery({
    queryKey: ["sales-refundable", branchId, folioSearch],
    enabled: !!branchId,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("id, folio, total, status, payment_method, created_at, customer_id")
        .eq("branch_id", branchId!)
        .in("status", ["completed", "partially_refunded"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (folioSearch.trim()) {
        const n = Number(folioSearch.trim());
        if (!Number.isNaN(n)) q = q.eq("folio", n);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SaleRow[];
    },
  });

  const openSale = async (sale: SaleRow) => {
    setSelected(sale);
    setMode("total");
    setReason("");
    const { data, error } = await supabase
      .from("sale_items")
      .select("id, product_id, name_snapshot, quantity, unit_price, discount, total")
      .eq("sale_id", sale.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as SaleItem[];
    setItems(rows);
    const qty: Record<string, number> = {};
    for (const r of rows) {
      if (r.product_id) qty[r.product_id] = r.quantity;
    }
    setPartialQty(qty);
  };

  const refund = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Sin venta");

      let payload: unknown = null;
      if (mode === "partial") {
        payload = items
          .filter((i) => i.product_id && (partialQty[i.product_id] ?? 0) > 0)
          .map((i) => ({
            product_id: i.product_id,
            quantity: Math.min(partialQty[i.product_id!] ?? 0, i.quantity),
          }));
        if (!(payload as unknown[]).length) throw new Error("Selecciona cantidades a devolver");
      }

      const { data, error } = await supabase.rpc("refund_sale", {
        _sale_id: selected.id,
        _items: payload as never,

... 