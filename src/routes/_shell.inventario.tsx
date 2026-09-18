/**
 * Inventario robusto — FASE 3
 * Ruta: src/routes/_shell.inventario.tsx (REEMPLAZAR)
 *
 * - Existencias + alertas de mínimo
 * - Ajuste con motivo (entrada/salida)
 * - Traspasos entre sucursales
 * - Historial de movimientos
 * - Editar mínimo / máximo
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { shortDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario por sucursal — Lula Shop OS" },
      {
        name: "description",
        content: "Existencias, ajustes, traspasos, mínimos y historial de movimientos.",
      },
      { property: "og:title", content: "Inventario por sucursal — Lula Shop OS" },
    ],
  }),
  component: InventarioPage,
});

type InvRow = {
  id: string;
  stock: number;
  min_stock: number;
  max_stock: number | null;
  product_id: string;
  products: { name: string; emoji: string | null; sku: string | null } | null;
};

const MOV_LABEL: Record<string, string> = {
  sale: "Venta",
  return: "Devolución",
  purchase: "Compra",
  adjustment_in: "Ajuste +",
  adjustment_out: "Ajuste −",
  transfer_in: "Traspaso entrada",
  transfer_out: "Traspaso salida",
};

function InventarioPage() {
  const { branchId, branches } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();

  // Ajuste
  const [adjProduct, setAdjProduct] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjDir, setAdjDir] = useState<"in" | "out">("in");

  // Traspaso
  const [trProduct, setTrProduct] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trQty, setTrQty] = useState("");
  const [trNotes, setTrNotes] = useState("");

  // Límites
  const [limProduct, setLimProduct] = useState("");
  const [limMin, setLimMin] = useState("0");
  const [limMax, setLimMax] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["inventory", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("id, stock, min_stock, max_stock, product_id, products(name, emoji, sku)")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as unknown as InvRow[];
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
        .limit(80);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const low = useMemo(
    () => rows.filter((r) => Number(r.stock) <= Number(r.min_stock)),
    [rows],
  );

  const otherBranches = branches.filter((b) => b.id !== branchId);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["movements"] });
    void qc.invalidateQueries({ queryKey: ["pos-products"] });
  };

  const adjust = useMutation({
    mutationFn: async () => {
      if (!branchId || !adjProduct) throw new Error("Elige sucursal y producto");
      const n = Math.abs(Number(adjQty));
      if (!n) throw new Error("Cantidad inválida");
      const signed = adjDir === "in" ? n : -n;
      const { error } = await supabase.rpc("adjust_stock", {
        _branch_id: branchId,
        _product_id: adjProduct,
        _variant_id: null as unknown as string,
        _quantity: signed,
        _notes: adjNotes || (adjDir === "in" ? "Ajuste entrada" : "Ajuste salida"),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventario ajustado");
      setAdjQty("");
      setAdjNotes("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transfer = useMutation({
    mutationFn: async () => {
      if (!branchId || !trTo || !trProduct) throw new Error("Completa origen, destino y producto");
      const n = Number(trQty);
      if (!n || n <= 0) throw new Error("Cantidad inválida");
      const { error } = await supabase.rpc("transfer_stock", {
        _from_branch_id: branchId,
        _to_branch_id: trTo,
        _product_id: trProduct,
        _quantity: n,
        _variant_id: null,
        _notes: trNotes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Traspaso realizado");
      setTrQty("");
      setTrNotes("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setLimits = useMutation({
    mutationFn: async () => {
      if (!branchId || !limProduct) throw new Error("Elige producto");
      const { error } = await supabase.rpc("set_inventory_limits", {
        _branch_id: branchId,
        _product_id: limProduct,
        _min_stock: Number(limMin) || 0,
        _max_stock: limMax === "" ? null : Number(limMax),
        _variant_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Límites actualizados");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Existencias por sucursal, ajustes, traspasos y alertas de stock mínimo.
        </p>
      </div>

      {low.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="size-4" />
              {low.length} producto(s) en o bajo el mínimo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {low.map((r) => r.products?.name).filter(Boolean).join(", ")}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="existencias">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="existencias">Existencias</TabsTrigger>
          <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
          <TabsTrigger value="traspasos">Traspasos</TabsTrigger>
          <TabsTrigger value="limites">Mín / Máx</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="existencias" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Existencias en esta sucursal</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Mín</TableHead>
                    <TableHead className="text-right">Máx</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const lowStock = Number(r.stock) <= Number(r.min_stock);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <span className="mr-1">{r.products?.emoji || "📦"}</span>
                          {r.products?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {r.products?.sku ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">{r.stock}</TableCell>
                        <TableCell className="text-right">{r.min_stock}</TableCell>
                        <TableCell className="text-right">{r.max_stock ?? "—"}</TableCell>
                        <TableCell>
                          {lowStock ? (
                            <Badge variant="destructive">Bajo</Badge>
                          ) : (
                            <Badge variant="secondary">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!isLoading && !rows.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        Sin registros de inventario en esta sucursal.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ajustes" className="mt-4">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Ajuste manual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Producto</Label>
                <Select value={adjProduct} onValueChange={setAdjProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar…" />
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
                <Label>Tipo</Label>
                <Select value={adjDir} onValueChange={(v) => setAdjDir(v as "in" | "out")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Entrada (+)</SelectItem>
                    <SelectItem value="out">Salida (−)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min={0}
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Input
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder="Merma, conteo físico, daño…"
                />
              </div>
              <Button
                className="w-full"
                disabled={!isManager || !adjProduct || !adjQty || adjust.isPending}
                onClick={() => adjust.mutate()}
              >
                {adjust.isPending ? "Aplicando…" : "Aplicar ajuste"}
              </Button>
              {!isManager && (
                <p className="text-xs text-muted-foreground">Solo managers pueden ajustar.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="traspasos" className="mt-4">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowLeftRight className="size-4" />
                Traspaso a otra sucursal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sale stock de la sucursal actual y entra en el destino.
              </p>
              <div className="space-y-2">
                <Label>Producto</Label>
                <Select value={trProduct} onValueChange={setTrProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar…" />
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
                <Label>Sucursal destino</Label>
                <Select value={trTo} onValueChange={setTrTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar…" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!otherBranches.length && (
                  <p className="text-xs text-amber-600">
                    Necesitas al menos 2 sucursales activas (créalas en Ajustes).
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  value={trQty}
                  onChange={(e) => setTrQty(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Input
                  value={trNotes}
                  onChange={(e) => setTrNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <Button
                className="w-full"
                disabled={!isManager || !trProduct || !trTo || !trQty || transfer.isPending}
                onClick={() => transfer.mutate()}
              >
                {transfer.isPending ? "Traspasando…" : "Traspasar"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limites" className="mt-4">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Mínimo y máximo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Producto</Label>
                <Select value={limProduct} onValueChange={setLimProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar…" />
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
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Mínimo</Label>
                  <Input
                    type="number"
                    min={0}
                    value={limMin}
                    onChange={(e) => setLimMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Máximo (opcional)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={limMax}
                    onChange={(e) => setLimMax(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!isManager || !limProduct || setLimits.isPending}
                onClick={() => setLimits.mutate()}
              >
                Guardar límites
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movimientos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial reciente</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {shortDate(m.created_at)}
                      </TableCell>
                      <TableCell>
                        {(m.products as { name?: string } | null)?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{MOV_LABEL[m.type] ?? m.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {m.notes ?? "—"}
                      </TableCell>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
