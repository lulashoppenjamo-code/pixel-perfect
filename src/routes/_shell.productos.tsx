import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_shell/productos")({
  head: () => ({
    meta: [
      { title: "Productos y categorías — Lula Shop OS" },
      { name: "description", content: "Alta, edición y baja de productos, precios, costos e impuestos, y organización por categorías." },
      { property: "og:title", content: "Productos y categorías — Lula Shop OS" },
      { property: "og:description", content: "Alta, edición y baja de productos, precios, costos e impuestos, y organización por categorías." },
    ],
  }),
  component: ProductosPage,
});

type ProductForm = {
  id?: string;
  sku: string;
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
  name: "",
  description: "",
  category_id: "none",
  price: "0",
  cost: "0",
  tax_rate: "0",
  emoji: "📦",
};

function ProductosPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("none");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id, name, parent_id").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, sku, name, description, price, cost, tax_rate, emoji, is_active, category_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveProduct = useMutation({
    mutationFn: async () => {
      const payload = {
        sku: form.sku || null,
        name: form.name,
        description: form.description || null,
        category_id: form.category_id === "none" ? null : form.category_id,
        price: Number(form.price),
        cost: Number(form.cost),
        tax_rate: Number(form.tax_rate),
        emoji: form.emoji || null,
      };
      const { error } = form.id
        ? await supabase.from("products").update(payload).eq("id", form.id)
        : await supabase.from("products").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Producto guardado");
      setForm(emptyProduct);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["pos-products"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
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
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo desactivar"),
  });

  const saveCategory = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("categories")
        .insert({ name: catName, parent_id: catParent === "none" ? null : catParent });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Categoría creada");
      setCatName("");
      setCatParent("none");
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <Tabs defaultValue="productos" className="space-y-4">
      <TabsList>
        <TabsTrigger value="productos">Productos</TabsTrigger>
        <TabsTrigger value="categorias">Categorías</TabsTrigger>
      </TabsList>

      <TabsContent value="productos" className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Catálogo</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Costo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id} className={p.is_active ? "" : "opacity-50"}>
                    <TableCell>
                      {p.emoji} {p.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                    <TableCell>{money(p.price)}</TableCell>
                    <TableCell>{money(p.cost)}</TableCell>
                    <TableCell className="text-right">
                      {isManager && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setForm({
                                id: p.id,
                                sku: p.sku ?? "",
                                name: p.name,
                                description: p.description ?? "",
                                category_id: p.category_id ?? "none",
                                price: String(p.price),
                                cost: String(p.cost),
                                tax_rate: String(p.tax_rate),
                                emoji: p.emoji ?? "",
                              })
                            }
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeProduct.mutate(p.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!products.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Aún no hay productos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{form.id ? "Editar producto" : "Nuevo producto"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isManager && <p className="text-sm text-muted-foreground">Tu rol no puede editar el catálogo.</p>}
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Emoji</Label>
                <Input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label>Precio</Label>
                <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Costo</Label>
                <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>IVA</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.tax_rate}
                  onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!isManager || !form.name || saveProduct.isPending}
                onClick={() => saveProduct.mutate()}
              >
                Guardar
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

      <TabsContent value="categorias" className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Categorías</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {categories.map((c) => (
                <li key={c.id} className="rounded border px-3 py-2">
                  {c.name}
                  {c.parent_id && (
                    <span className="text-muted-foreground">
                      {" "}
                      · sub de {categories.find((x) => x.id === c.parent_id)?.name}
                    </span>
                  )}
                </li>
              ))}
              {!categories.length && <li className="text-muted-foreground">Aún no hay categorías.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Nueva categoría</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Categoría padre</Label>
              <Select value={catParent} onValueChange={setCatParent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguna</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!isManager || !catName} onClick={() => saveCategory.mutate()}>
              Crear
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
