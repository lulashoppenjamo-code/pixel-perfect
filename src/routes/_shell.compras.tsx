import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Truck,
  PackageCheck,
  RefreshCw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { money, shortDate } from "@/lib/format";

import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";

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

import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

export const Route = createFileRoute(
  "/_shell/compras",
)({
  head: () => ({
    meta: [
      {
        title:
          "Compras y proveedores — Lula OS",
      },
      {
        name: "description",
        content:
          "Administra proveedores y órdenes de compra. Las compras recibidas alimentan el inventario central compartido.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="compras">
      <ComprasPage />
    </RequireNavAccess>
  ),
});

type ProductRow = {
  id: string;
  name: string;
  cost: number;
};

type PurchaseLine = {
  product_id: string;
  name: string;
  quantity: number;
  unit_cost: number;
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

type PurchaseRow = {
  id: string;
  status: string;
  total: number;
  created_at: string;
  received_at: string | null;
  suppliers:
    | {
        name: string | null;
      }
    | null;
};

function ComprasPage() {
  const { isManager, user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [supplierId, setSupplierId] =
    useState("none");

  const [lines, setLines] = useState<
    PurchaseLine[]
  >([]);

  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("0");

  const [supplierForm, setSupplierForm] =
    useState({
      name: "",
      phone: "",
      email: "",
    });

  /*
   * ============================================================
   * PROVEEDORES
   * ============================================================
   */

  const {
    data: suppliers = [],
    isLoading: loadingSuppliers,
  } = useQuery<SupplierRow[]>({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("suppliers")
          .select(
            "id, name, phone, email",
          )
          .order("name");

      if (error) throw error;

      return (data ??
        []) as SupplierRow[];
    },
  });

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const {
    data: products = [],
    isLoading: loadingProducts,
  } = useQuery<ProductRow[]>({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("products")
          .select(
            "id, name, cost",
          )
          .eq("is_active", true)
          .order("name");

      if (error) throw error;

      return (data ?? []).map(
        (product) => ({
          id: product.id,
          name: product.name,
          cost: Number(
            product.cost ?? 0,
          ),
        }),
      );
    },
  });

  /*
   * ============================================================
   * INVENTARIO CENTRAL
   *
   * Solo lectura para mostrar la existencia
   * actual antes de comprar.
   *
   * NO se modifica directamente desde aquí.
   *
   * La entrada real se realiza mediante:
   *
   * receive_purchase()
   *
   * y esa RPC actualiza shared_inventory.
   * ============================================================
   */

  const {
    data: sharedInventory = [],
    isLoading: loadingInventory,
  } = useQuery<SharedInventoryRow[]>({
    queryKey: ["shared-inventory", "compras"],
    queryFn: getSharedInventory,
  });

  const stockByProduct =
    new Map<string, number>();

  for (const row of sharedInventory) {
    stockByProduct.set(
      row.product_id,
      (stockByProduct.get(
        row.product_id,
      ) ?? 0) +
        Number(
          row.available_stock ?? 0,
        ),
    );
  }

  /*
   * ============================================================
   * COMPRAS
   * ============================================================
   */

  const {
    data: purchases = [],
    isLoading: loadingPurchases,
  } = useQuery<PurchaseRow[]>({
    queryKey: ["purchases", branchId],
    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("purchases")
          .select(
            `
              id,
              status,
              total,
              created_at,
              received_at,
              suppliers(name)
            `,
          )
          .eq(
            "branch_id",
            branchId!,
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          );

      if (error) throw error;

      return (data ??
        []) as PurchaseRow[];
    },
  });

  /*
   * ============================================================
   * TOTAL
   * ============================================================
   */

  const total = lines.reduce(
    (sum, line) =>
      sum +
      line.quantity *
        line.unit_cost,
    0,
  );

  /*
   * ============================================================
   * AGREGAR PARTIDA
   * ============================================================
   */

  const addLine = () => {
    if (!pick) {
      toast.error(
        "Selecciona un producto",
      );
      return;
    }

    const product =
      products.find(
        (item) =>
          item.id === pick,
      );

    if (!product) {
      toast.error(
        "Producto no encontrado",
      );
      return;
    }

    const quantity = Number(qty);

    const unitCost = Number(cost);

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      toast.error(
        "La cantidad debe ser mayor a cero",
      );
      return;
    }

    if (
      !Number.isFinite(unitCost) ||
      unitCost < 0
    ) {
      toast.error(
        "El costo no es válido",
      );
      return;
    }

    setLines((current) => [
      ...current,
      {
        product_id: product.id,
        name: product.name,
        quantity,
        unit_cost: unitCost,
      },
    ]);

    setPick("");
    setQty("1");
    setCost("0");
  };

  /*
   * ============================================================
   * CREAR ORDEN
   *
   * Crear la orden NO mete stock.
   *
   * El stock solamente entra cuando se recibe.
   * ============================================================
   */

  const createPurchase =
    useMutation({
      mutationFn: async () => {
        if (!isManager) {
          throw new Error(
            "No tienes permisos para crear compras",
          );
        }

        if (!branchId) {
          throw new Error(
            "No hay sucursal activa",
          );
        }

        if (!user?.id) {
          throw new Error(
            "Usuario no autenticado",
          );
        }

        if (!lines.length) {
          throw new Error(
            "Agrega al menos un producto",
          );
        }

        const { data, error }