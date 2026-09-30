/**
 * Productos y categorías — LULA OS
 * Ruta: src/routes/_shell.productos.tsx
 *
 * RESPONSIVE:
 * - Mobile first para celular y tablet.
 * - Sin cambiar la lógica del motor.
 *
 * INVENTARIO:
 * - La fuente oficial es shared_inventory.
 * - El inventario es único y compartido entre sucursales.
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
  image_url: string;
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
  image_url: "",
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
  image_url: string | null;
  is_active: boolean;
  categories:
    | {
        name: string;
      }
    | null;
};

function ProductosPage() {
  const { isManager, can } = useAuth();
  const canCreate = can("productos.create");
  const canEdit = can("productos.edit");
  const canDelete = can("productos.delete");
  const canPrice = can("productos.price");
  const qc = useQueryClient();

  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("none");
  const [search, setSearch] = useState("");
  /** Filtro visual de stock (client-side sobre stockMap compartido). */
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all");

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

    return products.filter((p) => {
      if (q) {
        const match =
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.barcode ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }

      if (stockFilter === "all") return true;

      const stock = stockMap.get(p.id);
      const available = Number(stock?.availableStock ?? 0);
      const isLow = sharedInventory.some(
        (row) =>
          row.product_id === p.id &&
          row.stock_status === "low_stock",
      );

      if (stockFilter === "out") return available <= 0;
      if (stockFilter === "low") return isLow && available > 0;
      return true;
    });
  }, [products, search, stockFilter, stockMap, sharedInventory]);

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

      // productos.price solo puede actualizar price/cost/tax_rate
      const payload =
        form.id && canPrice && !canEdit
          ? {
              price: Number(form.price) || 0,
              cost: Number(form.cost) || 0,
              tax_rate: Number(form.tax_rate) || 0,
            }
          : {
              sku: form.sku.trim() || null,
              barcode: form.barcode.trim() || null,
              name: form.name.trim(),
              description:
                form.description.trim() || null,
              category_id:
                form.category_id === "none"
                  ? null
                  : form.category_id,
              price: Number(form.price) || 0,
              cost: Number(form.cost) || 0,
              tax_rate: Number(form.tax_rate) || 0,
              emoji: form.emoji || "📦",
              image_url:
                form.image_url.trim() || null,
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
      image_url: p.image_url ?? "",
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
        title="Artículos"
        description="Catálogo, precios, costos, impuestos y códigos de barras."
      />

      {/* ========================================================
          RESUMEN
          ======================================================== */}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Productos
            </p>
            <p className="text-xl font-bold text-[#1a73e8] sm:text-2xl">
              {products.length}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Disponibles
            </p>
            <p className="text-xl font-bold text-[#212121] sm:text-2xl">
              {inventorySummary.totalAvailable}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Reservado
            </p>
            <p className="text-xl font-bold text-[#212121] sm:text-2xl">
              {inventorySummary.totalReserved}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#e0e0e0] shadow-sm">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[11px] font-medium text-[#757575] sm:text-xs">
              Agotados
            </p>
            <p className="text-xl font-bold text-[#c2185b] sm:text-2xl">
              {inventorySummary.outOfStock}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="lista">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="flex h-auto w-max min-w-full flex-nowrap gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm sm:w-full">
            <TabsTrigger
              value="lista"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Catálogo
            </TabsTrigger>

            <TabsTrigger
              value="form"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              {form.id ? "Gestionar" : "Nuevo"}
            </TabsTrigger>

            <TabsTrigger
              value="categorias"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Categorías
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ======================================================
            CATÁLOGO
            ====================================================== */}

        <TabsContent
          value="lista"
          className="mt-3 space-y-3 sm:mt-4 sm:space-y-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                className="h-11 rounded-xl bg-muted/30 pl-9 shadow-none"
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
              className="h-11 w-11 shrink-0 touch-manipulation rounded-xl"
              onClick={() => {
                void refetchInventory();
              }}
              title="Actualizar existencias"
              aria-label="Actualizar existencias"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {(
              [
                ["all", "Todos"],
                ["low", "Inventario bajo"],
                ["out", "Agotado"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStockFilter(key)}
                className={
                  stockFilter === key
                    ? "shrink-0 rounded-full bg-[#7e57c2] px-3.5 py-1.5 text-[12px] font-semibold text-white"
                    : "shrink-0 rounded-full bg-[#eeeeee] px-3.5 py-1.5 text-[12px] font-medium text-[#616161]"
                }
              >
                {label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
              Cargando...
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#e0e0e0] bg-white px-5 py-12 text-center shadow-sm sm:px-6 sm:py-14">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#e8f0fe] text-4xl">
                📦
              </div>

              <div>
                <p className="text-base font-bold text-[#212121]">
                  Sin artículos
                </p>

                <p className="mt-1 max-w-sm text-sm leading-5 text-[#757575]">
                  Crea un producto en la pestaña Nuevo o ajusta la búsqueda.
                </p>
              </div>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-2 gap-2 xs:grid-cols-3 sm:grid-cols-3 sm:gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                      "relative min-h-[188px] cursor-pointer touch-manipulation overflow-hidden rounded-xl border border-[#e0e0e0] bg-white shadow-sm transition active:scale-[0.99] hover:border-[#1a73e8] hover:shadow-md sm:min-h-[205px]",
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
                      <div className="absolute left-1/2 top-2.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#fce4ec] px-2.5 py-1 text-[10px] font-semibold text-[#c2185b] sm:text-[11px]">
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
                        <div className="absolute left-1/2 top-2.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#fff3e0] px-2.5 py-1 text-[10px] font-semibold text-[#e65100] sm:text-[11px]">
                          Stock bajo
                        </div>
                      )}

                    {/* ELIMINAR */}

                    {canDelete &&
                      p.is_active && (
                        <button
                          type="button"
                          className="absolute right-1.5 top-1.5 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 text-destructive shadow-sm transition hover:bg-background active:scale-95"
                          onClick={(e) => {
                            e.stopPropagation();

                            removeProduct.mutate(
                              p.id,
                            );
                          }}
                          aria-label={`Desactivar ${p.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}

                    <CardContent className="flex h-full min-h-[188px] flex-col items-center gap-1.5 p-2.5 pt-7 text-center sm:min-h-[205px] sm:p-3 sm:pt-7">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted text-2xl sm:h-16 sm:w-16 sm:text-3xl">
                        {p.emoji ?? "📦"}
                      </div>

                      <p className="line-clamp-2 min-h-[2.25rem] text-xs font-semibold leading-tight sm:text-sm">
                        {p.name}
                      </p>

                      {p.sku && (
                        <p className="max-w-full truncate font-mono text-[10px] text-muted-foreground sm:text-xs">
                          {p.sku}
                        </p>
                      )}

                      <p className="text-base font-bold text-[#1a73e8] sm:text-lg">
                        {money(
                          Number(p.price),
                        )}
                        {Number(p.cost) > 0 &&
                        Number(p.price) > 0 ? (
                          <span className="ml-1 text-[11px] font-semibold text-[#34a853]">
                            (
                            {(
                              ((Number(p.price) -
                                Number(p.cost)) /
                                Number(p.price)) *
                              100
                            ).toFixed(1)}
                            %)
                          </span>
                        ) : null}
                      </p>

                      {/* STOCK CENTRAL */}

                      <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
                        <Badge
                          variant={
                            agotado
                              ? "destructive"
                              : "secondary"
                          }
                          className="rounded-full px-2 text-[10px] sm:text-xs"
                        >
                          {available} disponibles
                        </Badge>

                        {reserved > 0 && (
                          <Badge
                            variant="outline"
                            className="rounded-full px-2 text-[10px] sm:text-xs"
                          >
                            {reserved} reservados
                          </Badge>
                        )}

                        {hasVariants && (
                          <Badge
                            variant="outline"
                            className="rounded-full px-2 text-[10px] sm:text-xs"
                          >
                            {stock?.variants ?? 0}{" "}
                            variantes
                          </Badge>
                        )}
                      </div>

                      {totalStock !==
                        available && (
                        <p className="text-[10px] text-muted-foreground sm:text-[11px]">
                          Existencia:{" "}
                          {totalStock}
                        </p>
                      )}

                      {p.categories?.name && (
                        <p className="max-w-full truncate text-[10px] text-muted-foreground sm:text-[11px]">
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
          className="mt-3 sm:mt-4"
        >
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-[#e0e0e0] bg-white shadow-sm">
            <div className="bg-[#1a73e8] px-4 py-3.5 text-white sm:px-5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-white/80 sm:text-[11px]">
                Gestión de inventarios
              </p>

              <h2 className="break-words text-lg font-bold leading-tight sm:text-xl">
                {form.id
                  ? form.name ||
                    "Gestionar artículo"
                  : "Nuevo artículo"}
              </h2>
            </div>

            <div className="space-y-4 p-3.5 sm:p-5">
              {/* Identidad */}

              <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[76px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label className="text-xs text-[#757575]">
                    Emoji
                  </Label>

                  <Input
                    value={form.emoji}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        emoji: e.target.value,
                      }))
                    }
                    className="h-11 rounded-xl border-[#e0e0e0] text-center text-lg"
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs text-[#757575]">
                    Nombre *
                  </Label>

                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Nombre del producto"
                    className="h-11 rounded-xl border-[#e0e0e0]"
                  />
                </div>
              </div>

              {/* Imagen */}
              <div className="space-y-2">
                <Label className="text-xs text-[#757575]">
                  Imagen del producto
                </Label>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e0e0e0] bg-[#f5f5f5] text-2xl">
                    {form.image_url ? (
                      <img
                        src={form.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{form.emoji || "📦"}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="h-11 cursor-pointer rounded-xl border-[#e0e0e0] text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-[#e8f0fe] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1a73e8]"
                      disabled={
                        !(canCreate || canEdit) ||
                        saveProduct.isPending
                      }
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          toast.error(
                            "La imagen no debe superar 5 MB",
                          );
                          return;
                        }
                        try {
                          const ext =
                            file.name
                              .split(".")
                              .pop()
                              ?.toLowerCase() || "jpg";
                          const {
                            data: { user: upUser },
                          } = await supabase.auth.getUser();
                          if (!upUser?.id) {
                            throw new Error(
                              "Sesión requerida para subir imagen",
                            );
                          }
                          // Path {uid}/... exigido por política Storage
                          const path = `${upUser.id}/${crypto.randomUUID()}.${ext}`;
                          const { error: upErr } =
                            await supabase.storage
                              .from("product-images")
                              .upload(path, file, {
                                upsert: false,
                                contentType:
                                  file.type || "image/jpeg",
                              });
                          if (upErr) throw upErr;
                          const { data: pub } =
                            supabase.storage
                              .from("product-images")
                              .getPublicUrl(path);
                          setForm((f) => ({
                            ...f,
                            image_url: pub.publicUrl,
                          }));
                          toast.success("Imagen cargada");
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "No se pudo subir la imagen",
                          );
                        } finally {
                          event.target.value = "";
                        }
                      }}
                    />
                    {form.image_url ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-lg"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            image_url: "",
                          }))
                        }
                      >
                        Quitar imagen
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Códigos */}

              <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Códigos
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      SKU
                    </Label>

                    <Input
                      value={form.sku}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          sku: e.target.value,
                        }))
                      }
                      placeholder="SKU-001"
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Código de barras
                    </Label>

                    <Input
                      value={form.barcode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          barcode: e.target.value,
                        }))
                      }
                      placeholder="EAN / UPC"
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-[#757575]">
                  Descripción
                </Label>

                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-[#e0e0e0]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-[#757575]">
                  Categoría
                </Label>

                <Select
                  value={form.category_id}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      category_id: v,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl border-[#e0e0e0]">
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

              {/* Precio / Costo / IVA */}

              <div className="rounded-xl border border-[#e0e0e0] bg-[#fafafa] p-3 sm:p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Precios
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Precio venta
                    </Label>

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
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white text-base font-bold text-[#1a73e8]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      Costo
                    </Label>

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
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#757575]">
                      IVA
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
                      className="h-11 rounded-xl border-[#e0e0e0] bg-white"
                    />
                  </div>
                </div>

                {Number(form.price) > 0 &&
                  Number(form.cost) >= 0 && (
                    <p className="mt-2 break-words text-xs text-[#757575]">
                      Margen aprox.:{" "}
                      <span className="font-semibold text-[#34a853]">
                        {money(
                          Number(form.price) -
                            Number(form.cost),
                        )}
                      </span>

                      {Number(form.price) > 0 && (
                        <span>
                          {" "}
                          (
                          {(
                            ((Number(form.price) -
                              Number(form.cost)) /
                              Number(form.price)) *
                            100
                          ).toFixed(0)}
                          %)
                        </span>
                      )}
                    </p>
                  )}
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button
                  className="min-h-11 w-full touch-manipulation rounded-xl bg-[#1a73e8] text-base font-semibold hover:bg-[#1557b0] sm:flex-1"
                  disabled={
                    saveProduct.isPending ||
                    (form.id
                      ? !(canEdit || canPrice)
                      : !canCreate)
                  }
                  onClick={() =>
                    saveProduct.mutate()
                  }
                >
                  {saveProduct.isPending
                    ? "Guardando…"
                    : form.id
                      ? "Guardar cambios"
                      : "Crear artículo"}
                </Button>

                {form.id && (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full touch-manipulation rounded-xl border-[#e0e0e0] sm:w-auto"
                    onClick={() =>
                      setForm(emptyProduct)
                    }
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ======================================================
            CATEGORÍAS
            ====================================================== */}

        <TabsContent
          value="categorias"
          className="mt-3 sm:mt-4"
        >
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            <Card>
              <CardHeader className="pb-3">
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
                    className="h-11 rounded-xl"
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
                    <SelectTrigger className="h-11 rounded-xl">
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
                  className="min-h-11 w-full touch-manipulation rounded-xl"
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
              <CardHeader className="pb-3">
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
                  <ul className="space-y-1.5 text-sm">
                    {categories.map((c) => (
                      <li
                        key={c.id}
                        className="min-h-11 rounded-xl border px-3 py-2.5"
                      >
                        {c.name}
                      </li>
                    ))}

                    {!categories.length && (
                      <li className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
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