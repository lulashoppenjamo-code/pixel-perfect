/**
 * Productos y categorías — LULA OS
 * Ruta: src/routes/_shell.productos.tsx
 * Reemplaza el archivo existente completo.
 * Incluye campo barcode / código de barras.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
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

export const Route = createFileRoute("/_shell/productos")({
  head: () => ({
    meta: [{ title: "Productos — Lula OS" }],
  }),
  component: ProductosPage,
});

type ProductForm = {
  id?: string;
  sku: string;
  barcode: string;
  name: string;
  description: string;
  category_id: string;
  price: string;
  cost: string;
  tax_rate: string;
  emoji: string;
};

const emptyProduct: ProductForm = {
  sku: "",
  barcode: "",
  name: "",
  description: "",
  category_id: "none",
  price: "0",
  cost: "0",
  tax_rate: "0.16",
  emoji: "📦",
};

function ProductosPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("none");
  const [search, setSearch] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, sku, barcode, name, description, category_id, price, cost, tax_rate, emoji, is_active, categories(name)",
        )
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.barcode ?? "").toLowerCase().includes(q)
    );
  });

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Nombre requerido");
      const payload = {
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id === "none" ? null : form.category_id,
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        emoji: form.emoji || "📦",
        is_active: true,
      };
      if (form.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Producto actualizado" : "Producto creado");
      setForm(emptyProduct);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
      void qc.invalidateQueries({ queryKey: ["inv-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto desactivado");
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (!catName.trim()) throw new Error("Nombre de categoría requerido");
      const { error } = await supabase.from("categories").insert({
        name: catName.trim(),
        parent_id: catParent === "none" ? null : catParent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoría creada");
      setCatName("");
      setCatParent("none");
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editProduct = (p: (typeof products)[0]) => {
    setForm({
      id: p.id,
      sku: p.sku ?? "",
      barcode: (p as { barcode?: string | null }).barcode ?? "",
      name: p.name,
      description: p.description ?? "",
      category_id: p.category_id ?? "none",
      price: String(p.price ?? 0),
      cost: String(p.cost ?? 0),
      tax_rate: String(p.tax_rate ?? 0),
      emoji: p.emoji ?? "📦",
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo, precios, costos, impuestos y códigos de barras.
        </p>
      </div>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista">Catálogo</TabsTrigger>
          <TabsTrigger value="form">{form.id ? "Editar" : "Nuevo"}</TabsTrigger>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
        </TabsList>

        <TabsContent value="lista" className="mt-4 space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar nombre, SKU o barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((p) => (
                    <TableRow key={p.id} className={!p.is_active ? "opacity-50" : undefined}>
                      <TableCell className="text-lg">{p.emoji ?? "📦"}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {(p as { barcode?: string | null }).barcode ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(p.categories as { name?: string } | null)?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(Number(p.price))}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {money(Number(p.cost))}
                      </TableCell>
                      <TableCell>
                        {p.is_active ? (
                          <Badge variant="secondary">Activo</Badge>
                        ) : (
                          <Badge variant="outline">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={!isManager}
                            onClick={() => editProduct(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {p.is_active && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              disabled={!isManager}
                              onClick={() => removeProduct.mutate(p.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                        Sin productos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="form" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">
                {form.id ? "Editar producto" : "Nuevo producto"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>Emoji</Label>
                  <Input
                    value={form.emoji}
                    onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                    className="text-center text-lg"
                  />
                </div>
                <div className="col-span-3 space-y-1.5">
                  <Label>Nombre *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nombre del producto"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>SKU</Label>
                  <Input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    placeholder="SKU-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Código de barras</Label>
                  <Input
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    placeholder="EAN / UPC / interno"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descripción</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin categoría</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Precio</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Costo</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>IVA (ej. 0.16)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.tax_rate}
                    onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={!isManager || saveProduct.isPending}
                  onClick={() => saveProduct.mutate()}
                >
                  {saveProduct.isPending ? "Guardando…" : form.id ? "Actualizar" : "Crear"}
                </Button>
                {form.id && (
                  <Button variant="outline" onClick={() => setForm(emptyProduct)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categorias" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nueva categoría</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nombre</Label>
                  <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Padre (opcional)</Label>
                  <Select value={catParent} onValueChange={setCatParent}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ninguno</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={!isManager || saveCategory.isPending}
                  onClick={() => saveCategory.mutate()}
                >
                  Crear categoría
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Listado</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {categories.map((c) => (
                    <li key={c.id} className="rounded border px-3 py-2">
                      {c.name}
                    </li>
                  ))}
                  {!categories.length && (
                    <li className="text-muted-foreground">Sin categorías.</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
