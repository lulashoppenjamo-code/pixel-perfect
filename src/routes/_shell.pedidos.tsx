import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";

/**
 * BLOQUE 12 — Visual Pedidos online.
 * Sin tocar create/fulfill/cancel RPC ni inventario.
 * + Tabs Pedidos | Catálogo | Config + botón Ver tienda
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
  ExternalLink,
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
          `id, status, total, customer_name, customer_phone, delivery_address, created_at, notes`,
        )
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

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

  const {
    data: sharedInventory = [],
    isLoading: loadingInventory,
  } = useQuery<SharedInventoryRow[]>({
    queryKey: ["shared-inventory", "pedidos"],
    queryFn: getSharedInventory,
    refetchInterval: 15_000,
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

  const increaseLine = (productId: string) => {
    setLines((previous) =>
      previous.map((line) => {
        if (line.product_id !== productId) return line;
        if (line.quantity >= line.available_stock) {
          toast.error(`Solo hay ${line.available_stock} disponibles`);
          return line;
        }
        return { ...line, quantity: line.quantity + 1 };
      }),
    );
  };

  const decreaseLine = (productId: string) => {
    setLines((previous) =>
      previous
        .map((line) =>
          line.product_id === productId
            ? { ...line, quantity: line.quantity - 1 }
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

  const orderTotal = useMemo(
    () =>
      lines.reduce(
        (total, line) => total + line.unit_price * line.quantity,
        0,
      ),
    [lines],
  );

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("No hay sucursal activa");
      if (!lines.length) throw new Error("Agrega al menos un producto");
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
    onError: (error: Error) => toast.error(error.message),
  });

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
    onError: (error: Error) => toast.error(error.message),
  });

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
    onError: (error: Error) => toast.error(error.message),
  });

  const invalidateOperationalQueries = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["online-orders"] }),
      qc.invalidateQueries({ queryKey: ["shared-inventory"] }),
      qc.invalidateQueries({ queryKey: ["pos-products-shared"] }),
      qc.invalidateQueries({ queryKey: ["pos-variant-inventory-shared"] }),
    ]);
  };

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

  const pendingOrders = orders.filter(
    (order) =>
      order.status !== "delivered" && order.status !== "cancelled",
  ).length;

  const reservedValue = orders
    .filter(
      (order) =>
        order.status !== "delivered" && order.status !== "cancelled",
    )
    .reduce((total, order) => total + Number(order.total), 0);

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
              asChild
            >
              <a href="/tienda" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Ver tienda en línea
              </a>
            </Button>

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