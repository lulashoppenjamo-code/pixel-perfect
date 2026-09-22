import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/PageHeader";
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
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_shell/devoluciones")({
  head: () => ({
    meta: [{ title: "Devoluciones — Lula OS" }],
  }),
  component: DevolucionesPage,
});

type SaleItem = {
  id: string;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  discount: number;
  total: number;
  product_id: string | null;
};

function DevolucionesPage() {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const [folioSearch, setFolioSearch] = useState("");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: recentSales = [], isLoading } = useQuery({
    queryKey: ["recent-sales-refund", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, folio, total, status, created_at, payment_method")
        .eq("branch_id", branchId!)
        .in("status", ["completed", "partially_refunded"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filteredSales = folioSearch.trim()
    ? recentSales.filter((s) => String(s.folio).includes(folioSearch.trim()))
    : recentSales;

  const { data: saleItems = [] } = useQuery({
    queryKey: ["sale-items-refund", selectedSaleId],
    enabled: !!selectedSaleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("id, name_snapshot, unit_price, quantity, discount, total, product_id")
        .eq("sale_id", selectedSaleId!);
      if (error) throw error;
      return (data ?? []) as SaleItem[];
    },
  });

  const openRefund = (saleId: string) => {
    setSelectedSaleId(saleId);
    setSelectedItems({});
    setReason("");
    setDialogOpen(true);
  };

  const toggleItem = (item: SaleItem, checked: boolean) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (checked) next[item.id] = item.quantity;
      else delete next[item.id];
      return next;
    });
  };

  const setQty = (itemId: string, qty: number, max: number) => {
    const v = Math.min(Math.max(1, qty), max);
    setSelectedItems((prev) => ({ ...prev, [itemId]: v }));
  };

  const refund = useMutation({
    mutationFn: async () => {
      if (!selectedSaleId) throw new Error("Sin venta");
      const items = Object.entries(selectedItems).map(([sale_item_id, quantity]) => ({
        sale_item_id,
        quantity,
      }));
      if (!items.length) throw new Error("Selecciona al menos un producto");

      const { data, error } = await supabase.rpc("refund_sale", {
        _sale_id: selectedSaleId,
        _items: items,
        _reason: reason || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Devolución registrada. Stock actualizado.");
      setDialogOpen(false);
      setSelectedSaleId(null);
      void qc.invalidateQueries({ queryKey: ["recent-sales-refund"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (err: Error) => toast.error(err.message || "Error al devolver"),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default",
      partially_refunded: "secondary",
      refunded: "outline",
      cancelled: "destructive",
    };
    return <Badge variant={map[status] ?? "outline"}>{status}</Badge>;
  };

  return (
    <PageShell>
      <PageHeader
        icon={RotateCcw}
        title="Devoluciones"
        description="Busca una venta por folio y regresa productos al inventario."
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Ventas recientes</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={folioSearch}
                onChange={(e) => setFolioSearch(e.target.value)}
                placeholder="Buscar folio..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Folio</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Cargando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredSales.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No hay ventas disponibles para devolver.
                  </TableCell>
                </TableRow>
              )}
              {filteredSales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-semibold">#{s.folio}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(s.created_at).toLocaleString("es-MX")}
                  </TableCell>
                  <TableCell className="font-medium">{money(Number(s.total))}</TableCell>
                  <TableCell className="capitalize">{s.payment_method}</TableCell>
                  <TableCell>{statusBadge(s.status)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openRefund(s.id)}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Devolver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar devolución</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              {saleItems.map((item) => {
                const checked = item.id in selectedItems;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => toggleItem(item, !!c)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name_snapshot}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity} × {money(Number(item.unit_price))}
                      </p>
                    </div>
                    {checked && (
                      <Input
                        type="number"
                        min={1}
                        max={item.quantity}
                        value={selectedItems[item.id] ?? item.quantity}
                        onChange={(e) =>
                          setQty(item.id, Number(e.target.value), item.quantity)
                        }
                        className="h-8 w-20"
                      />
                    )}
                  </div>
                );
              })}
              {!saleItems.length && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Cargando ítems...
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Motivo (opcional)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. Producto defectuoso, cambio de talla..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={Object.keys(selectedItems).length === 0 || refund.isPending}
              onClick={() => refund.mutate()}
            >
              {refund.isPending ? "Procesando..." : "Confirmar devolución"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
