import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario por sucursal — Lula Shop OS" },
      { name: "description", content: "Consulta existencias por sucursal, alertas de stock mínimo y el historial de movimientos." },
      { property: "og:title", content: "Inventario por sucursal — Lula Shop OS" },
      { property: "og:description", content: "Consulta existencias por sucursal, alertas de stock mínimo y el historial de movimientos." },
    ],
  }),
  component: InventarioPage,
});

function InventarioPage() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["inventory", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("id, stock, min_stock, max_stock, product_id, products(name, emoji, sku)")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["movements", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id, type, quantity, notes, created_at, products(name)")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const adjust = useMutation({
    mutationFn: async () => {
      if (!branchId || !productId) throw new Error("Elige sucursal y producto");
      const { error } = await supabase.rpc("adjust_stock", {
        _branch_id: branchId,
        _product_id: productId,
        _variant_id: null,
        _quantity: Number(qty),
        _notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventario ajustado");
      setQty("");
      setNotes("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo ajustar"),
  });

  const low = rows.filter((r) => Number(r.stock) <= Number(r.min_stock));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {low.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4" /> {low.length} producto(s) en o bajo el mínimo
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {low.map((r) => r.products?.name).join(", ")}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Existencias</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Mínimo</TableHead>
                  <TableHead>Máximo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.products?.emoji} {r.products?.name}
                    </TableCell>
                    <TableCell className={Number(r.stock) <= Number(r.min_stock) ? "font-semibold text-destructive" : ""}>
                      {Number(r.stock)}
                    </TableCell>
                    <TableCell>{Number(r.min_stock)}</TableCell>
                    <TableCell>{r.max_stock == null ? "—" : Number(r.max_stock)}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Sin existencias registradas en esta sucursal.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Movimientos recientes</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{shortDate(m.created_at)}</TableCell>
                    <TableCell>{m.products?.name ?? "—"}</TableCell>
                    <TableCell>{m.type}</TableCell>
                    <TableCell>{Number(m.quantity)}</TableCell>
                    <TableCell className="text-muted-foreground">{m.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {!movements.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Sin movimientos todavía.
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
          <CardTitle>Ajuste de stock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isManager && <p className="text-sm text-muted-foreground">Tu rol no puede ajustar inventario.</p>}
          <div className="space-y-2">
            <Label>Producto</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige un producto" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cantidad (negativa para salida)</Label>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="w-full" disabled={!isManager || !qty || !productId} onClick={() => adjust.mutate()}>
            Aplicar ajuste
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
