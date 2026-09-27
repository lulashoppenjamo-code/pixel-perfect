import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Package,
  Play,
  CheckCircle2,
  History,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import {
  getSharedInventory,
  setSharedInventoryLimits,
} from "@/lib/sharedInventory";
import { money, shortDate } from "@/lib/format";

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
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

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

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { ImportExportPanel } from "@/components/inventory/ImportExportPanel";
import { RestockList } from "@/components/inventory/RestockList";
import { PhysicalCountProgress } from "@/components/inventory/PhysicalCountProgress";

export const Route = createFileRoute("/_shell/inventario")({
  head: () => ({
    meta: [
      {
        title: "Inventario — Lula OS",
      },
      {
        name: "description",
        content:
          "Inventario compartido, ajustes, conteo físico, límites e historial.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="inventario">
      <InventarioPage />
    </RequireNavAccess>
  ),
});

type InventoryRow = Awaited<
  ReturnType<typeof getSharedInventory>
>[number];

type CountRow = {
  id: string;
  branch_id: string;
  status: string;
  notes: string | null;
  started_by: string | null;
  completed_by: string | null;
  started_at: string;
  completed_at: string | null;
};

type CountItemRow = {
  id: string;
  count_id: string;
  product_id: string;
  variant_id: string | null;
  system_stock: number;
  counted_stock: number | null;
  difference: number | null;
  unit_cost: number;
  difference_value: number | null;
  counted_at: string | null;
  products:
    | {
        name: string;
        sku: string | null;
      }
    | null;
};

const MOVEMENT_LABELS: Record<string, string> = {
  sale: "Venta",
  return: "Devolución",
  purchase: "Compra",
  adjustment_in: "Ajuste +",
  adjustment_out: "Ajuste −",
  transfer_in: "Entrada",
  transfer_out: "Salida",
};

function InventarioPage() {
  const { isManager } = useAuth();
  const { branchId, branches, loading: branchLoading } = useBranch();
  const queryClient = useQueryClient();

  const activeBranch = branches.find(
    (branch) => branch.id === branchId,
  );

  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustDirection, setAdjustDirection] =
    useState<"in" | "out">("in");

  const [limitProduct, setLimitProduct] = useState("");
  const [limitMin, setLimitMin] = useState("0");
  const [limitMax, setLimitMax] = useState("");

  const [countFilter, setCountFilter] = useState("");
  const [countNotes, setCountNotes] = useState("");

  const [physicalCount, setPhysicalCount] =
    useState<Record<string, string>>({});

  const invalidateInventory = () => {
    void queryClient.invalidateQueries({
      queryKey: ["shared-inventory"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["pos-products-shared"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["pos-variant-inventory-shared"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-movements"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-counts"],
    });

    void queryClient.invalidateQueries({
      queryKey: ["inventory-count-items"],
    });
  };

  const {
    data: inventory = [],
    isLoading: inventoryLoading,
    error: inventoryError,
  } = useQuery({
    queryKey: ["shared-inventory"],
    queryFn: getSharedInventory,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["inv-products-shared"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sku,barcode")
        .eq("is_active", true)
        .order("name");

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["inventory-movements"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(
          "id,type,quantity,notes,created_at,products(name)",
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(100);

      if (error) {
        throw error;
      }

      return data ?? [];
    },
  });

  const {
    data: inventoryCounts = [],
    isLoading: countsLoading,
  } = useQuery({
    queryKey: ["inventory-counts", branchId],
    enabled: !!branchId,

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("inventory_counts")
          .select(
            `
            id,
            branch_id,
            status,
            notes,
            started_by,
            completed_by,
            started_at,
            completed_at
          `,
          )
          .eq("branch_id", branchId!)
          .order("started_at", {
            ascending: false,
          })
          .limit(30);

      if (error) {
        throw error;
      }

      return (data ?? []) as CountRow[];
    },
  });

  const activeCount =
    inventoryCounts.find(
      (count) => count.status === "counting",
    ) ?? null;

  const {
    data: activeCountItems = [],
    isLoading: activeCountItemsLoading,
  } = useQuery({
    queryKey: [
      "inventory-count-items",
      activeCount?.id,
    ],

    enabled: !!activeCount?.id,

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("inventory_count_items")
          .select(
            `
            id,
            count_id,
            product_id,
            variant_id,
            system_stock,
            counted_stock,
            difference,
            unit_cost,
            difference_value,
            counted_at,
            products(name,sku)
          `,
          )
          .eq("count_id", activeCount!.id)
          .order("product_id");

      if (error) {
        throw error;
      }

      return (data ?? []) as CountItemRow[];
    },
  });

  const lowStock = useMemo(
    () =>
      inventory.filter(
        (row) =>
          Number(row.available_stock) <=