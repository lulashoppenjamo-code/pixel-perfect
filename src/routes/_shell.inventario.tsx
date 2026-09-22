/**
 * Inventario — LULA OS
 * Ruta: src/routes/_shell.inventario.tsx
 * Reemplaza el archivo existente completo.
 *
 * - Existencias + alertas de mínimo
 * - Ajuste con motivo
 * - Traspasos entre sucursales (RPC transfer_stock)
 * - Límites min/max
 * - Conteo físico
 * - Historial de movimientos
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, ClipboardList, Package, FileSpreadsheet } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { ImportExportPanel } from "@/components/inventory/ImportExportPanel";

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      { title: "Inventario — Lula OS" },
      {
        name: "description",
        content: "Existencias, ajustes, traspasos, conteo físico y movimientos.",
      },
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
  products: { name: string; emoji: string | null; sku: string | null; barcode: string | null } | null;
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

  // Conteo físico: product_id -> counted qty
  const [countMap, setCountMap] = useState<Record<string, string>>({});
  const [countFilter, setCountFilter] = useState("");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
    void qc.invalidateQueries({ queryKey: ["pos-products"] });
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["inventory", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select(
          "id, stock, min_stock, max_stock, product_id, products(name, emoji, sku, barcode)",
        )
        .eq("branch_id", branchId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InvRow[];
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements", branchId],
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
    queryKey: ["inv-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const lowStock = useMemo(
    () => rows.filter((r) => Number(r.stock) <= Number(r.min_stock)),
    [rows],
  );

  const countRows = useMemo(() => {
    const q = countFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = r.products?.name?.toLowerCase() ?? "";
      const sku = r.products?.sku?.toLowerCase() ?? "";
      const barcode = r.products?.barcode?.toLowerCase() ?? "";
      return name.includes(q) || sku.includes(q) || barcode.includes(q);
    });
  }, [rows, countFilter]);

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

  // Conteo físico: aplica diferencias como ajustes
  const applyCount = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Sin sucursal");
      if (!isManager) throw new Error("Sin permisos");

      const diffs: { product_id: string; delta: number; name: string }[] = [];
      for (const r of rows) {
        const raw = countMap[r.product_id];
        if (raw === undefined || raw === "") continue;
        const counted = Number(raw);
        if (Number.isNaN(counted) || counted < 0) continue;
        const delta = counted - Number(r.stock);
        if (delta === 0) continue;
        diffs.push({
          product_id: r.product_id,
          delta,
          name: r.products?.name ?? r.product_id,
        });
      }
      if (!diffs.length) throw new Error("No hay diferencias para aplicar");

      for (const d of diffs) {
        const { error } = await supabase.rpc("adjust_stock", {
          _branch_id: branchId,
          _product_id: d.product_id,
          _variant_id: null as unknown as string,
          _quantity: d.delta,
          _notes: `Conteo físico (${d.delta > 0 ? "+" : ""}${d.delta})`,
        });
        if (error) throw new Error(`${d.name}: ${error.message}`);
      }
      return diffs.length;
    },
    onSuccess: (n) => {
      toast.success(`Conteo aplicado: ${n} producto(s) ajustado(s)`);
      setCountMap({});
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const productOptions = products.map((p) => (
    <SelectItem key={p.id} value={p.id}>
      {p.name}
      {p.sku ? ` (${p.sku})` : ""}
    </SelectItem>
  ));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Existencias, ajustes, traspasos, conteo físico e historial.
          </p>
        </div>
        {lowStock.length > 0 && (
          <Badge variant="destructive" className="w-fit gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {lowStock.length} bajo mínimo
          </Badge>
        )}
      </div>

      <Tabs defaultValue="existencias">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="existencias">Existencias</TabsTrigger>
          <TabsTrigger value="ajuste">Ajuste</TabsTrigger>
          <TabsTrigger value="traspaso">Traspaso</TabsTrigger>
          <TabsTrigger value="limites">Límites</TabsTrigger>
          <TabsTrigger value="conteo">
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            Conteo físico
          </TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="importar">
            <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />
            Importar / Exportar
          </TabsTrigger>
        </TabsList>

        {/* EXISTENCIAS */}
        <TabsContent value="existencias" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Stock por sucursal</CardTitle>
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
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                        Sin registros de inventario en esta sucursal.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => {
                    const low = Number(r.stock) <= Number(r.min_stock);
                    return (
                      <TableRow key={r.id} className={cn(low && "bg-destructive/5")}>
                        <TableCell className="font-medium">
                          <span className="mr-1.5">{r.products?.emoji ?? "📦"}</span>
                          {r.products?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.products?.sku ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {Number(r.stock)}
                        </TableCell>
                        <TableCell className="text-right">{Number(r.min_stock)}</TableCell>
                        <TableCell className="text-right">
                          {r.max_stock != null ? Number(r.max_stock) : "—"}
                        </TableCell>
                        <TableCell>
                          {low ? (
                            <Badge variant="destructive">Bajo</Badge>
                          ) : (
                            <Badge variant="secondary">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AJUSTE */}
        <TabsContent value="ajuste" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">Ajuste manual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Producto</Label>
                <Select value={adjProduct} onValueChange={setAdjProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>
                  <SelectContent>{productOptions}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Dirección</Label>
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
                <div className="space-y-1.5">
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={adjQty}
                    onChange={(e) => setAdjQty(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Motivo</Label>
                <Input
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  placeholder="Merma, conteo, daño…"
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
                <p className="text-xs text-muted-foreground">Solo managers pueden ajustar stock.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TRASPASO */}
        <TabsContent value="traspaso" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowLeftRight className="h-4 w-4" />
                Traspaso entre sucursales
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Origen: sucursal activa. Destino: otra sucursal.
              </p>
              <div className="space-y-1.5">
                <Label>Producto</Label>
                <Select value={trProduct} onValueChange={setTrProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>
                  <SelectContent>{productOptions}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sucursal destino</Label>
                <Select value={trTo} onValueChange={setTrTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches
                      .filter((b) => b.id !== branchId)
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trQty}
                  onChange={(e) => setTrQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
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

        {/* LÍMITES */}
        <TabsContent value="limites" className="mt-4">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-base">Mínimo / máximo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Producto</Label>
                <Select value={limProduct} onValueChange={setLimProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona producto" />
                  </SelectTrigger>
                  <SelectContent>{productOptions}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Mínimo</Label>
                  <Input
                    type="number"
                    min="0"
                    value={limMin}
                    onChange={(e) => setLimMin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Máximo (vacío = sin límite)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={limMax}
                    onChange={(e) => setLimMax(e.target.value)}
                  />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!isManager || !limProduct || setLimits.isPending}
                onClick={() => setLimits.mutate()}
              >
                {setLimits.isPending ? "Guardando…" : "Guardar límites"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONTEO FÍSICO */}
        <TabsContent value="conteo" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Conteo físico</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Captura la cantidad real. Al aplicar se generan ajustes por la diferencia.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Filtrar producto / SKU / barcode…"
                    value={countFilter}
                    onChange={(e) => setCountFilter(e.target.value)}
                    className="w-full sm:w-56"
                  />
                  <Button
                    disabled={!isManager || applyCount.isPending}
                    onClick={() => applyCount.mutate()}
                  >
                    {applyCount.isPending ? "Aplicando…" : "Aplicar diferencias"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Teórico</TableHead>
                    <TableHead className="w-36 text-right">Contado</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {countRows.map((r) => {
                    const theoretical = Number(r.stock);
                    const raw = countMap[r.product_id];
                    const counted = raw === undefined || raw === "" ? null : Number(raw);
                    const diff =
                      counted === null || Number.isNaN(counted) ? null : counted - theoretical;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.products?.emoji ?? "📦"} {r.products?.name ?? "—"}
                          {r.products?.sku && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {r.products.sku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{theoretical}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="ml-auto h-8 w-28 text-right"
                            value={raw ?? ""}
                            onChange={(e) =>
                              setCountMap((prev) => ({
                                ...prev,
                                [r.product_id]: e.target.value,
                              }))
                            }
                            placeholder="—"
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium",
                            diff !== null && diff > 0 && "text-emerald-600",
                            diff !== null && diff < 0 && "text-destructive",
                          )}
                        >
                          {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!countRows.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                        No hay productos para contar en esta sucursal.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MOVIMIENTOS */}
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
                      <TableCell className="whitespace-nowrap text-xs">
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
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
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

        <TabsContent value="importar" className="mt-4">
          <ImportExportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
