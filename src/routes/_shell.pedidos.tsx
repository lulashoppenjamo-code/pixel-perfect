import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";

/**
 * BLOQUE 12 — Visual Pedidos online.
 * Solo presentación (+ acciones en móvil que ya existían en desktop).
 * Sin tocar create/fulfill/cancel RPC ni inventario.
 * + Tabs: Pedidos | Catálogo | Config tienda (sin perder nada anterior)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Store,
  Check,
  X,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  LayoutGrid,
  Settings2,
  Palette,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";
import {
  loadStoreConfig,
  saveStoreConfig,
  subscribeStoreConfig,
  type StoreConfig,
  type StoreBanner,
  DEFAULT_STORE_CONFIG,
} from "@/lib/store/storeConfig";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_shell/pedidos")({
  head: () => ({
    meta: [{ title: "Pedidos online — Lula OS" }],
  }),
  component: () => (
    <RequireNavAccess navKey="pedidos">
      <PedidosPage />
    </RequireNavAccess>
  ),
});

type OrderRow = {
  id: string;
  status: string;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  created_at: string;
  notes: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
};

type OrderLine = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  available_stock: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "default",
  confirmed: "secondary",
  preparing: "secondary",
  ready: "outline",
  delivered: "secondary",
  cancelled: "destructive",
};

function PedidosPage() {
  const { branchId } = useBranch();
  const { isManager } = useAuth();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [pickProduct, setPickProduct] = useState("");
  const [pickQty, setPickQty] = useState("1");
  const [lines, setLines] = useState<OrderLine[]>([]);

  // Config tienda (nuevo)
  const [config, setConfig] = useState<StoreConfig>(DEFAULT_STORE_CONFIG);
  const [tab, setTab] = useState("pedidos");

  useEffect(() => {
    setConfig(loadStoreConfig());
    return subscribeStoreConfig(() => setConfig(loadStoreConfig()));
  }, []);

  const saveConfig = () => {
    saveStoreConfig(config);
    toast.success("Configuración de tienda guardada");
  };

  const updateTheme = (
    key: keyof StoreConfig["theme"],
    value: string | number,
  ) => {
    setConfig((c) => ({
      ...c,
      theme: { ...c.theme, [key]: value },
    }));
  };

  const updateBanner = (id: string, patch: Partial<StoreBanner>) => {
    setConfig((c) => ({
      ...c,
      banners: c.banners.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };

  const addBanner = () => {
    const id = `b${Date.now()}`;
    setConfig((c) => ({
      ...c,
      banners: [
        ...c.banners,
        {
          id,
          title: "Nuevo banner",
          subtitle: "",
          ctaText: "Ver más",
          ctaLink: "#",
          bgColor: "#e11d48",
          textColor: "#ffffff",
          active: true,
          order: c.banners.length + 1,
        },
      ],
    }));
  };

  const removeBanner = (id: string) => {
    setConfig((c) => ({
      ...c,
      banners: c.banners.filter((b) => b.id !== id),
    }));
  };

  /*
   * ============================================================
   * PEDIDOS
   * ============================================================
   */
  const {
    data: orders = [],
    isLoading: loadingOrders,
  } = useQuery({
    queryKey: ["online-orders", branchId],
    enabled: !!branchId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_orders")
        .select(
          `
            id,
            status,
            total,
            customer_name,
            customer_phone,
            delivery_address,
            created_at,
            notes
          `,
        )
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  /*
   * ============================================================
   * CATÁLOGO
   * ============================================================
   */
  const { data: products = [], isLoading: loadingProducts } =
    useQuery<ProductRow[]>({
      queryKey: ["online-order-products"],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("products")
          .select("id, name, price, sku")
          .eq("is_active", true)
          .order("name");

        if (error) throw error;

        return (data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          sku: p.sku ?? null,
        }));
      },
    });

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   * ============================================================
   */
  const {
    data: sharedInventory = [],
    isLoading: loadingInventory,
  } = useQuery<SharedInventoryRow[]>({
    queryKey: ["shared-inventory", "pedidos"],
    queryFn: getSharedInventory,
  });

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sharedInventory) {
      const current = map.get(row.product_id) ?? 0;
      map.set(
        row.product_id,
        current + Number(row.available_stock ?? 0),
      );
    }
    return map;
  }, [sharedInventory]);

  const selectableProducts = useMemo(() => {
    return products.filter((product) => {
      return (stockByProduct.get(product.id) ?? 0) > 0;
    });
  }, [products, stockByProduct]);

  const catalogWithStock = useMemo(() => {
    return products.map((p) => ({
      ...p,
      stock: stockByProduct.get(p.id) ?? 0,
    }));
  }, [products, stockByProduct]);

  /*
   * ============================================================
   * AGREGAR PRODUCTO
   * ============================================================
   */
  const addLine = () => {
    const product = products.find((item) => item.id === pickProduct);

    if (!product) {
      toast.error("Selecciona un producto");
      return;
    }

    const available = stockByProduct.get(product.id) ?? 0;

    if (available <= 0) {
      toast.error("Producto sin existencia disponible");
      return;
    }

    const quantity = Math.max(1, Number(pickQty) || 1);

    setLines((previous) => {
      const existing = previous.find(
        (line) => line.product_id === product.id,
      );

      if (existing) {
        const newQuantity = existing.quantity + quantity;

        if (newQuantity > available) {
          toast.error(`Solo hay ${available} disponibles`);
          return previous;
        }

        return previous.map((line) =>
          line.product_id === product.id
            ? {
                ...line,
                quantity: newQuantity,
                available_stock: available,
              }
            : line,
        );
      }

      return [
        ...previous,
        {
          product_id: product.id,
          name: product.name,
          unit_price: product.price,
          quantity: Math.min(quantity, available),
          available_stock: available,
        },
      ];
    });

    setPickProduct("");
    setPickQty("1");
  };

  /*
   * ============================================================
   * CAMBIAR CANTIDAD
   * ============================================================
   */
  const increaseLine = (productId: string) => {
    setLines((previous) =>
      previous.map((line) => {
        if (line.product_id !== productId) {
          return line;
        }

        if (line.quantity >= line.available_stock) {
          toast.error(`Solo hay ${line.available_stock} disponibles`);
          return line;
        }

        return {
          ...line,
          quantity: line.quantity + 1,
        };
      }),
    );
  };

  const decreaseLine = (productId: string) => {
    setLines((previous) =>
      previous
        .map((line) =>
          line.product_id === productId
            ? {
                ...line,
                quantity: line.quantity - 1,
              }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const removeLine = (productId: string) => {
    setLines((previous) =>
      previous.filter((line) => line.product_id !== productId),
    );
  };

  /*
   * ============================================================
   * TOTAL
   * ============================================================
   */
  const orderTotal = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.unit_price * line.quantity,
        0,
      ),
    [lines],
  );

  /*
   * ============================================================
   * CREAR PEDIDO
   * ============================================================
   */
  const createOrder = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error("No hay sucursal activa");
      }

      if (!lines.length) {
        throw new Error("Agrega al menos un producto");
      }

      for (const line of lines) {
        const currentStock = stockByProduct.get(line.product_id) ?? 0;

        if (line.quantity > currentStock) {
          throw new Error(
            `Stock insuficiente para ${line.name}. Disponible: ${currentStock}`,
          );
        }
      }

      const items = lines.map((line) => ({
        product_id: line.product_id,
        name: line.name,
        unit_price: line.unit_price,
        quantity: line.quantity,
      }));

      const { data, error } = await supabase.rpc("create_online_order", {
        _branch_id: branchId,
        _items: items,
        ...(customerName.trim()
          ? { _customer_name: customerName.trim() }
          : {}),
        ...(customerPhone.trim()
          ? { _customer_phone: customerPhone.trim() }
          : {}),
        ...(address.trim() ? { _delivery_address: address.trim() } : {}),
        ...(notes.trim() ? { _notes: notes.trim() } : {}),
      });

      if (error) throw error;
      return data;
    },

    onSuccess: () => {
      toast.success("Pedido creado y stock reservado");
      closeCreateDialog();

      void qc.invalidateQueries({ queryKey: ["online-orders"] });
      void qc.invalidateQueries({ queryKey: ["shared-inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-products-shared"] });
      void qc.invalidateQueries({
        queryKey: ["pos-variant-inventory-shared"],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  /*
   * ============================================================
   * ENTREGAR
   * ============================================================
   */
  const fulfill = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("fulfill_online_order", {
        _order_id: orderId,
      });
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Pedido entregado y stock descontado");
      void invalidateOperationalQueries();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  /*
   * ============================================================
   * CANCELAR
   * ============================================================
   */
  const cancel = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("cancel_online_order", {
        _order_id: orderId,
      });
      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Pedido cancelado y reserva liberada");
      void invalidateOperationalQueries();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const invalidateOperationalQueries = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["online-orders"] }),
      qc.invalidateQueries({ queryKey: ["shared-inventory"] }),
      qc.invalidateQueries({ queryKey: ["pos-products-shared"] }),
      qc.invalidateQueries({ queryKey: ["pos-variant-inventory-shared"] }),
    ]);
  };

  /*
   * ============================================================
   * LIMPIAR FORMULARIO
   * ============================================================
   */
  const closeCreateDialog = () => {
    setCreateOpen(false);
    setCustomerName("");
    setCustomerPhone("");
    setAddress("");
    setNotes("");
    setPickProduct("");
    setPickQty("1");
    setLines([]);
  };

  const openCreateDialog = () => {
    setLines([]);
    setCustomerName("");
    setCustomerPhone("");
    setAddress("");
    setNotes("");
    setPickProduct("");
    setPickQty("1");
    setCreateOpen(true);
  };

  /*
   * ============================================================
   * BADGE
   * ============================================================
   */
  const statusBadge = (status: string) => {
    const color =
      status === "cancelled"
        ? "border-transparent bg-[#ffebee] text-[#c62828]"
        : status === "delivered"
          ? "border-transparent bg-[#e8f5e9] text-[#2e7d32]"
          : status === "ready"
            ? "border-transparent bg-[#e3f2fd] text-[#1565c0]"
            : status === "pending"
              ? "border-transparent bg-[#fff8e1] text-[#f57f17]"
              : "border-transparent bg-[#f5f5f5] text-[#616161]";

    return (
      <Badge
        variant={STATUS_VARIANT[status] ?? "outline"}
        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${color}`}
      >
        {STATUS_LABEL[status] ?? status}
      </Badge>
    );
  };

  /*
   * ============================================================
   * RESUMEN
   * ============================================================
   */
  const pendingOrders = orders.filter(
    (order) =>
      order.status !== "delivered" && order.status !== "cancelled",
  ).length;

  const reservedOrders = orders.filter(
    (order) =>
      order.status !== "delivered" && order.status !== "cancelled",
  );

  const reservedValue = reservedOrders.reduce(
    (total, order) => total + Number(order.total),
    0,
  );

  return (
    <PageShell>
      <PageHeader
        icon={Store}
        title="Pedidos online"
        description="Pedidos online con reserva de stock compartido + catálogo y configuración de tienda."
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              className="min-h-11 touch-manipulation"
              onClick={() => {
                void invalidateOperationalQueries();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Actualizar
            </Button>

            <Button
              className="min-h-11 touch-manipulation rounded-xl bg-[#34a853] font-bold text-white shadow-sm hover:bg-[#2d8f47]"
              disabled={
                !isManager ||
                loadingInventory ||
                selectableProducts.length === 0
              }
              onClick={openCreateDialog}
            >
              <Store className="mr-2 h-4 w-4" />
              Nuevo pedido
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList className="mb-4 grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
          <TabsTrigger value="pedidos" className="gap-1.5">
            <Store className="h-4 w-4" />
            Pedidos
          </TabsTrigger>
          <TabsTrigger value="catalogo" className="gap-1.5">
            <LayoutGrid className="h-4 w-4" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Config tienda
          </TabsTrigger>
        </TabsList>

        {/* ========== TAB PEDIDOS (todo lo original) ========== */}
        <TabsContent value="pedidos" className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                  Activos
                </p>
                <p className="mt-1 text-lg font-bold text-[#1a73e8] sm:text-xl">
                  {pendingOrders}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                  Reservado
                </p>
                <p className="mt-1 text-lg font-bold text-[#212121] sm:text-xl">
                  {money(reservedValue)}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
              <CardContent className="p-3 sm:p-4">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#757575]">
                  Disponibles
                </p>
                <p className="mt-1 text-lg font-bold text-[#212121] sm:text-xl">
                  {selectableProducts.length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-xl border border-[#e0e0e0] bg-white shadow-sm">
            <CardHeader className="border-b border-[#f0f0f0] pb-3">
              <CardTitle className="text-base font-bold text-[#212121]">
                Órdenes recientes
              </CardTitle>
            </CardHeader>

            <CardContent className="px-3 sm:px-6">
              <div className="overflow-x-auto">
                {/* Móvil */}
                <div className="grid gap-2.5 lg:hidden">
                  {loadingOrders ? (
                    <div className="rounded-2xl border border-[#e0e0e0] bg-white py-12 text-center shadow-sm">
                      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />
                      <p className="text-sm font-medium text-[#757575]">
                        Cargando pedidos…
                      </p>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#e0e0e0] bg-white py-12 text-center">
                      <p className="text-sm font-medium text-[#757575]">
                        Aún no hay pedidos online.
                      </p>
                    </div>
                  ) : (
                    orders.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-xl border border-[#e0e0e0] bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#212121]">
                              {order.customer_name ?? "Sin nombre"}
                            </p>
                            <p className="text-xs text-[#757575]">
                              {shortDate(order.created_at)}
                            </p>
                            <p className="mt-1 text-sm text-[#424242]">
                              {order.customer_phone ?? "—"}
                            </p>
                            {order.delivery_address && (
                              <p className="mt-0.5 truncate text-xs text-[#757575]">
                                {order.delivery_address}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            {statusBadge(order.status)}
                            <p className="mt-1 font-bold text-[#212121]">
                              {money(Number(order.total))}
                            </p>
                          </div>
                        </div>

                        {order.status !== "delivered" &&
                          order.status !== "cancelled" &&
                          isManager && (
                            <div className="mt-3 flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1"
                                disabled={
                                  fulfill.isPending || cancel.isPending
                                }
                                onClick={() => fulfill.mutate(order.id)}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                Entregar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                disabled={
                                  fulfill.isPending || cancel.isPending
                                }
                                onClick={() => cancel.mutate(order.id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                      </div>
                    ))
                  )}
                </div>

                {/* Desktop */}
                <Table className="hidden lg:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Teléfono</TableHead>
                      <TableHead>Dirección</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {shortDate(order.created_at)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {order.customer_name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {order.customer_phone ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">
                          {order.delivery_address ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {money(Number(order.total))}
                        </TableCell>
                        <TableCell>{statusBadge(order.status)}</TableCell>
                        <TableCell className="text-right">
                          {order.status !== "delivered" &&
                            order.status !== "cancelled" &&
                            isManager && (
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    fulfill.isPending || cancel.isPending
                                  }
                                  onClick={() => fulfill.mutate(order.id)}
                                >
                                  <Check className="mr-1 h-3.5 w-3.5" />
                                  Entregar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  disabled={
                                    fulfill.isPending || cancel.isPending
                                  }
                                  onClick={() => cancel.mutate(order.id)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Cancelar
                                </Button>
                              </div>
                            )}
                        </TableCell>
                      </TableRow>
                    ))}

                    {!loadingOrders && orders.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-muted-foreground"
                        >
                          Aún no hay pedidos online.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== TAB CATÁLOGO ========== */}
        <TabsContent value="catalogo" className="space-y-4">
          <div className="rounded-xl border border-rose-100 bg-rose-50/50 px-4 py-3 text-sm text-rose-900">
            <strong>Catálogo completo</strong> desde tu base de datos + stock
            compartido. Este mismo catálogo se usa al crear pedidos.
          </div>

          {loadingProducts || loadingInventory ? (
            <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
          ) : catalogWithStock.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay productos activos.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {catalogWithStock.map((p) => (
                <Card
                  key={p.id}
                  className="overflow-hidden rounded-xl border border-[#e0e0e0]"
                >
                  <CardContent className="p-4">
                    <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-rose-50 text-3xl">
                      💅
                    </div>
                    <p className="line-clamp-2 text-sm font-semibold leading-tight">
                      {p.name}
                    </p>
                    {p.sku && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        SKU: {p.sku}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-bold text-rose-700">
                        {money(p.price)}
                      </span>
                      <Badge
                        variant={p.stock > 0 ? "secondary" : "destructive"}
                        className="text-[10px]"
                      >
                        {p.stock > 0 ? `${p.stock} disp.` : "Agotado"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ========== TAB CONFIG TIENDA ========== */}
        <TabsContent value="config" className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                Configuración de tienda en línea
              </h3>
              <p className="text-sm text-muted-foreground">
                Textos, banners, colores y envío gratis (estilo Alejandra Nail
                Shop). Se aplica a la vista pública `/tienda`.
              </p>
            </div>
            <Button onClick={saveConfig} className="gap-2">
              <Palette className="h-4 w-4" />
              Guardar configuración
            </Button>
          </div>

          <Card className="rounded-xl border border-[#e0e0e0]">
            <CardHeader>
              <CardTitle className="text-base">Colores y textos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Color primario</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="h-10 w-14 p-1"
                    value={config.theme.primary}
                    onChange={(e) => updateTheme("primary", e.target.value)}
                  />
                  <Input
                    value={config.theme.primary}
                    onChange={(e) => updateTheme("primary", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color secundario</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="h-10 w-14 p-1"
                    value={config.theme.secondary}
                    onChange={(e) => updateTheme("secondary", e.target.value)}
                  />
                  <Input
                    value={config.theme.secondary}
                    onChange={(e) => updateTheme("secondary", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Barra de promoción (arriba)</Label>
                <Input
                  value={config.theme.promoBarText}
                  onChange={(e) =>
                    updateTheme("promoBarText", e.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Título del hero</Label>
                <Input
                  value={config.theme.heroTitle}
                  onChange={(e) => updateTheme("heroTitle", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Subtítulo del hero</Label>
                <Input
                  value={config.theme.heroSubtitle}
                  onChange={(e) =>
                    updateTheme("heroSubtitle", e.target.value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Envío gratis desde ($)</Label>
                <Input
                  type="number"
                  value={config.theme.freeShippingFrom}
                  onChange={(e) =>
                    updateTheme(
                      "freeShippingFrom",
                      Number(e.target.value) || 0,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Texto envío gratis</Label>
                <Input
                  value={config.theme.freeShippingText}
                  onChange={(e) =>
                    updateTheme("freeShippingText", e.target.value)
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-[#e0e0e0]">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Banners / promociones</CardTitle>
              <Button size="sm" variant="outline" onClick={addBanner}>
                <Plus className="mr-1 h-4 w-4" />
                Agregar banner
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {config.banners
                .sort((a, b) => a.order - b.order)
                .map((b) => (
                  <div
                    key={b.id}
                    className="space-y-3 rounded-xl border p-4"
                    style={{ backgroundColor: b.bgColor + "15" }}
                  >
                    <div className="flex items-center justify-between">
                      <Label className="font-semibold">Banner {b.order}</Label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={b.active ? "default" : "outline"}
                          onClick={() =>
                            updateBanner(b.id, { active: !b.active })
                          }
                        >
                          {b.active ? "Activo" : "Inactivo"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => removeBanner(b.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Título</Label>
                        <Input
                          value={b.title}
                          onChange={(e) =>
                            updateBanner(b.id, { title: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Subtítulo</Label>
                        <Input
                          value={b.subtitle || ""}
                          onChange={(e) =>
                            updateBanner(b.id, { subtitle: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Texto botón</Label>
                        <Input
                          value={b.ctaText || ""}
                          onChange={(e) =>
                            updateBanner(b.id, { ctaText: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Link botón</Label>
                        <Input
                          value={b.ctaLink || ""}
                          onChange={(e) =>
                            updateBanner(b.id, { ctaLink: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Color fondo</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            className="h-9 w-12 p-1"
                            value={b.bgColor}
                            onChange={(e) =>
                              updateBanner(b.id, { bgColor: e.target.value })
                            }
                          />
                          <Input
                            value={b.bgColor}
                            onChange={(e) =>
                              updateBanner(b.id, { bgColor: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Color texto</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            className="h-9 w-12 p-1"
                            value={b.textColor}
                            onChange={(e) =>
                              updateBanner(b.id, {
                                textColor: e.target.value,
                              })
                            }
                          />
                          <Input
                            value={b.textColor}
                            onChange={(e) =>
                              updateBanner(b.id, {
                                textColor: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div
                      className="mt-2 rounded-lg px-4 py-6 text-center"
                      style={{
                        backgroundColor: b.bgColor,
                        color: b.textColor,
                      }}
                    >
                      <p className="text-lg font-bold">{b.title}</p>
                      {b.subtitle && (
                        <p className="mt-1 text-sm opacity-90">{b.subtitle}</p>
                      )}
                      {b.ctaText && (
                        <button
                          type="button"
                          className="mt-3 rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium"
                        >
                          {b.ctaText}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog crear pedido — IDÉNTICO al original */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeCreateDialog();
          } else {
            setCreateOpen(true);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo pedido online</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <Input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Nombre del cliente"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Teléfono / WhatsApp"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Dirección de entrega</Label>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Dirección"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Notas del pedido"
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1 space-y-1.5">
                <Label>Producto</Label>
                <Select value={pickProduct} onValueChange={setPickProduct}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar…" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({money(p.price)}) —{" "}
                        {stockByProduct.get(p.id) ?? 0} disp.
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-20 space-y-1.5">
                <Label>Cant.</Label>
                <Input
                  type="number"
                  min={1}
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                />
              </div>
              <Button type="button" onClick={addLine}>
                <Plus className="mr-1 h-4 w-4" />
                Agregar
              </Button>
            </div>

            <div>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Agrega productos al pedido.
                </p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => (
                    <div
                      key={line.product_id}
                      className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {line.name}
                      </span>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => decreaseLine(line.product_id)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>

                        <span className="w-8 text-center text-sm font-medium">
                          {line.quantity}
                        </span>

                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() => increaseLine(line.product_id)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="w-24 text-right font-medium">
                        {money(line.unit_price * line.quantity)}
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => removeLine(line.product_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {lines.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted p-4">
                <span className="font-medium">Total del pedido</span>
                <span className="text-xl font-bold">{money(orderTotal)}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeCreateDialog}
              disabled={createOrder.isPending}
            >
              Cancelar
            </Button>

            <Button
              disabled={createOrder.isPending || !lines.length}
              onClick={() => createOrder.mutate()}
            >
              {createOrder.isPending
                ? "Creando..."
                : "Crear pedido y reservar stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}