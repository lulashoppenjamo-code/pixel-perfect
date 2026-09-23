/**
 * Productos y categorías — LULA OS
 * Ruta: src/routes/_shell.productos.tsx
 *
 * IMPORTANTE:
 * El stock operativo YA NO se obtiene de la tabla legacy "inventory".
 * La fuente oficial es "shared_inventory".
 *
 * El inventario es único y compartido entre las sucursales.
 *
 * Para productos con variantes:
 * - shared_inventory puede tener varias filas con el mismo product_id.
 * - cada variante conserva su propio variant_id.
 * - la tarjeta del producto muestra la suma de available_stock.
 */

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  Search,
  Package,
  RefreshCw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";
import { money } from "@/lib/format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/productos")({
  head: () => ({
    meta: [{ title: "Productos — Lula OS" }],
  }),

  component: () => (
    <RequireNavAccess navKey="productos">
      <ProductosPage />
    </RequireNavAccess>
  ),
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

type ProductRow = {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  price: number;
  cost: number;
  tax_rate: number;
  emoji: string | null;
  is_active: boolean;
  categories:
    | {
        name: string;
      }
    | null;
};

function ProductosPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();

  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("none");
  const [search, setSearch] = useState("");

  /*
   * ============================================================
   * CATEGORÍAS
   * ============================================================
   */

  const {
    data: categories = [],
    isLoading: categoriesLoading,
  } = useQuery({
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

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const {
    data: products = [],
    isLoading: productsLoading,
  } = useQuery<ProductRow[]>({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          `
            id,
            sku,
            barcode,
            name,
            description,
            category_id,
            price,
            cost,
            tax_rate,
            emoji,
            is_active,
            categories(name)
          `,
        )
        .order("name");

      if (error) throw error;

      return (data ?? []) as ProductRow[];
    },
  });

  /*
   * ============================================================
   * INVENTARIO COMPARTIDO
   *
   * ESTA ES LA FUENTE OFICIAL.
   *
   * NO usamos:
   *   inventory
   *   branch_id
   *
   * El stock pertenece al inventario central compartido.
   * ============================================================
   */

  const {
    data: sharedInventory = [],
    isLoading: inventoryLoading,
    refetch: refetchInventory,
  } = useQuery<SharedInventoryRow[]>({
    queryKey: ["shared-inventory", "products"],
    queryFn: getSharedInventory,
  });

  /*
   * ============================================================
   * MAPA DE STOCK POR PRODUCTO
   *
   * Producto simple:
   *   una fila sin variant_id.
   *
   * Producto con variantes:
   *   varias filas con el mismo product_id.
   *
   * En la tarjeta del catálogo mostramos el total disponible
   * sumando las variantes.
   * ============================================================
   */

  const stockMap = useMemo(() => {
    const map = new Map<
      string,
      {
        stock: number;
        reservedStock: number;
        availableStock: number;
        variants: number;
        hasVariants: boolean;
      }
    >();

    for (const row of sharedInventory) {
      const current = map.get(row.product_id);

      if (!current) {
        map.set(row.product_id, {
          stock: Number(row.stock ?? 0),
          reservedStock: Number(row.reserved_stock ?? 0),
          availableStock: Number(row.available_stock ?? 0),
          variants: row.variant_id ? 1 : 0,
          hasVariants: !!row.variant_id,
        });
        continue;
      }

      current.stock += Number(row.stock ?? 0);
      current.reservedStock += Number(row.reserved_stock ?? 0);
      current.availableStock += Number(row.available_stock ?? 0);

      if (row.variant_id) {
        current.variants += 1;
        current.hasVariants = true;
      }
    }

    return map;
  }, [sharedInventory]);

  /*
   * ============================================================
   * FILTRO
   * ============================================================
   */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return products;

    return products.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search]);

  /*
   * ============================================================
   * GUARDAR PRODUCTO
   * ============================================================
   */

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) {
        throw new Error("Nombre requerido");
      }

      const payload = {
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id:
          form.category_id === "none"
            ? null
            : form.category_id,
        price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        tax_rate: Number(form.tax_rate) || 0,
        emoji: form.emoji || "📦",
        is_active: true,
      };

      if (form.id) {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", form.id);

        if (error) throw error;

        return;
      }

      const { error } = await supabase
        .from("products")
        .insert(payload);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        form.id
          ? "Producto actualizado"
          : "Producto creado",
      );

      setForm(emptyProduct);

      void qc.invalidateQueries({
        queryKey: ["products"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-products"],
      });

      void qc.invalidateQueries({
        queryKey: ["inv-products"],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory", "products"],
      });
    },

    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  /*
   * ============================================================
   * DESACTIVAR PRODUCTO
   * ============================================================
   */

  const removeProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("products")
        .update({
          is_active: false,
        })
        .eq("id", id);

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Producto desactivado");

      void qc.invalidateQueries({
        queryKey: ["products"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-products"],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory", "products"],
      });
    },

    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  /*
   * ============================================================
   * CREAR CATEGORÍA
   * ============================================================
   */

  const saveCategory = useMutation({
    mutationFn: async () => {
      if (!catName.trim()) {
        throw new Error(
          "Nombre de categoría requerido",
        );
      }

      const { error } = await supabase
        .from("categories")
        .insert({
          name: catName.trim(),
          parent_id:
            catParent === "none"
              ? null
              : catParent,
        });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Categoría creada");

      setCatName("");
      setCatParent("none");

      void qc.invalidateQueries({
        queryKey: ["categories"],
      });
    },

    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  /*
   * ============================================================
   * EDITAR PRODUCTO
   * ============================================================
   */

  const editProduct = (p: ProductRow) => {
    setForm({
      id: p.id,
      sku: p.sku ?? "",
      barcode: p.barcode ?? "",
      name: p.name,
      description: p.description ?? "",
      category_id: p.category_id ?? "none",
      price: String(p.price ?? 0),
      cost: String(p.cost ?? 0),
      tax_rate: String(p.tax_rate ?? 0),
      emoji: p.emoji ?? "📦",
    });
  };

  /*
   * ============================================================
   * RESUMEN DE INVENTARIO
   * ============================================================
   */

  const inventorySummary = useMemo(() => {
    let totalUnits = 0;
    let totalAvailable = 0;
    let totalReserved = 0;
    let outOfStock = 0;
    let lowStock = 0;

    for (const item of stockMap.values()) {
      totalUnits += item.stock;
      totalAvailable += item.availableStock;
      totalReserved += item.reservedStock;

      if (item.availableStock <= 0) {
        outOfStock += 1;
      }
    }

    for (const row of sharedInventory) {
      if (row.stock_status === "low_stock") {
        lowStock += 1;
      }
    }

    return {
      totalUnits,
      totalAvailable,
      totalReserved,
      outOfStock,
      lowStock,
    };
  }, [sharedInventory, stockMap]);

  const loading =
    productsLoading || inventoryLoading;

  return (
    <PageShell>
      <PageHeader
        icon={Package}
        title="Items"
        description="Catálogo, precios, costos, impuestos y códigos de barras."
      />

      {/* ========================================================
          RESUMEN
          ======================================================== */}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Productos
            </p>

            <p className="text-2xl font-bold">
              {products.length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Existencia disponible
            </p>

            <p className="text-2xl font-bold">
              {inventorySummary.totalAvailable}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Reservado
            </p>

            <p className="text-2xl font-bold">
              {inventorySummary.totalReserved}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Agotados
            </p>

            <p className="text-2xl font-bold text-destructive">
              {inventorySummary.outOfStock}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista">
            Catálogo
          </TabsTrigger>

          <TabsTrigger value="form">
            {form.id ? "Editar" : "Nuevo"}
          </TabsTrigger>

          <TabsTrigger value="categorias">
            Categorías
          </TabsTrigger>
        </TabsList>

        {/* ======================================================
            CATÁLOGO
            ====================================================== */}

        <TabsContent
          value="lista"
          className="mt-4 space-y-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                className="rounded-xl bg-muted/30 pl-9 shadow-none"
                placeholder="Buscar nombre, SKU o barcode…"
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
              />
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void refetchInventory();
              }}
              title="Actualizar existencias"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {loading && (
            <p className="py-10 text-center text-muted-foreground">
              Cargando...
            </p>
          )}

          {!loading && filtered.length === 0 && (
            <p className="py-10 text-center text-muted-foreground">
              Sin productos.
            </p>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filtered.map((p) => {
                const stock = stockMap.get(p.id);

                const available =
                  Number(
                    stock?.availableStock ?? 0,
                  );

                const totalStock =
                  Number(
                    stock?.stock ?? 0,
                  );

                const reserved =
                  Number(
                    stock?.reservedStock ?? 0,
                  );

                const hasVariants =
                  stock?.hasVariants ?? false;

                const agotado =
                  available <= 0;

                return (
                  <Card
                    key={p.id}
                    className={cn(
                      "relative cursor-pointer overflow-hidden transition hover:shadow-md",
                      !p.is_active &&
                        "opacity-50",
                    )}
                    onClick={() =>
                      isManager &&
                      editProduct(p)
                    }
                  >
                    {/* ESTADO */}

                    {agotado && (
                      <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                        Agotado
                      </div>
                    )}

                    {!agotado &&
                      stock &&
                      sharedInventory.some(
                        (row) =>
                          row.product_id ===
                            p.id &&
                          row.stock_status ===
                            "low_stock",
                      ) && (
                        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-700">
                          Stock bajo
                        </div>
                      )}

                    {/* ELIMINAR */}

                    {isManager &&
                      p.is_active && (
                        <button
                          type="button"
                          className="absolute right-1.5 top-1.5 z-10 rounded-full bg-background/80 p-1 text-destructive hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();

                            removeProduct.mutate(
                              p.id,
                            );
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}

                    <CardContent className="flex flex-col items-center gap-1.5 p-3 pt-5 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted text-3xl">
                        {p.emoji ?? "📦"}
                      </div>

                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight">
                        {p.name}
                      </p>

                      {p.sku && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.sku}
                        </p>
                      )}

                      <p className="text-base font-bold text-primary">
                        {money(
                          Number(p.price),
                        )}
                      </p>

                      {/* STOCK CENTRAL */}

                      <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
                        <Badge
                          variant={
                            agotado
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {available} disponibles
                        </Badge>

                        {reserved > 0 && (
                          <Badge variant="outline">
                            {reserved} reservados
                          </Badge>
                        )}

                        {hasVariants && (
                          <Badge variant="outline">
                            {stock?.variants ?? 0}{" "}
                            variantes
                          </Badge>
                        )}
                      </div>

                      {/* EXISTENCIA TOTAL */}

                      {totalStock !==
                        available && (
                        <p className="text-[11px] text-muted-foreground">
                          Existencia:{" "}
                          {totalStock}
                        </p>
                      )}

                      {p.categories?.name && (
                        <p className="text-[11px] text-muted-foreground">
                          {p.categories.name}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ======================================================
            FORMULARIO PRODUCTO
            ====================================================== */}

        <TabsContent
          value="form"
          className="mt-4"
        >
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base">
                {form.id
                  ? "Editar producto"
                  : "Nuevo producto"}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>Emoji</Label>

                  <Input
                    value={form.emoji}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        emoji: e.target.value,
                      }))
                    }
                    className="text-center text-lg"
                  />
                </div>

                <div className="col-span-3 space-y-1.5">
                  <Label>Nombre *</Label>

                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Nombre del producto"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>SKU</Label>

                  <Input
                    value={form.sku}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sku: e.target.value,
                      }))
                    }
                    placeholder="SKU-001"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Código de barras</Label>

                  <Input
                    value={form.barcode}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        barcode: e.target.value,
                      }))
                    }
                    placeholder="EAN / UPC / interno"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descripción</Label>

                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Categoría</Label>

                <Select
                  value={form.category_id}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      category_id: v,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="none">
                      Sin categoría
                    </SelectItem>

                    {categories.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                      >
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
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        price: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Costo</Label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        cost: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    IVA (ej. 0.16)
                  </Label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.tax_rate}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        tax_rate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  disabled={
                    !isManager ||
                    saveProduct.isPending
                  }
                  onClick={() =>
                    saveProduct.mutate()
                  }
                >
                  {saveProduct.isPending
                    ? "Guardando…"
                    : form.id
                      ? "Actualizar"
                      : "Crear"}
                </Button>

                {form.id && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setForm(emptyProduct)
                    }
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ======================================================
            CATEGORÍAS
            ====================================================== */}

        <TabsContent
          value="categorias"
          className="mt-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Nueva categoría
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nombre</Label>

                  <Input
                    value={catName}
                    onChange={(e) =>
                      setCatName(e.target.value)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Padre (opcional)
                  </Label>

                  <Select
                    value={catParent}
                    onValueChange={setCatParent}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="none">
                        Ninguno
                      </SelectItem>

                      {categories.map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                        >
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  disabled={
                    !isManager ||
                    saveCategory.isPending
                  }
                  onClick={() =>
                    saveCategory.mutate()
                  }
                >
                  {saveCategory.isPending
                    ? "Creando…"
                    : "Crear categoría"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Listado
                </CardTitle>
              </CardHeader>

              <CardContent>
                {categoriesLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Cargando categorías…
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {categories.map((c) => (
                      <li
                        key={c.id}
                        className="rounded border px-3 py-2"
                      >
                        {c.name}
                      </li>
                    ))}

                    {!categories.length && (
                      <li className="text-muted-foreground">
                        Sin categorías.
                      </li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}