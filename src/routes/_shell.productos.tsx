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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                      <div className="absolute left-1/2 top-2.5 z-10 -translate-x-1/2 whitespace-nowrap rounded