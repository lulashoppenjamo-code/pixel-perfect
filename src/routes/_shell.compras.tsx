import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  PackageCheck,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";

import { RequireNavAccess } from "@/components/RequireNavAccess";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
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
import { PageHeader, PageShell } from "@/components/PageHeader";

export const Route = createFileRoute("/_shell/compras")({
  head: () => ({
    meta: [
      { title: "Compras y proveedores — Lula Shop OS" },
      {
        name: "description",
        content:
          "Administra proveedores y órdenes de compra; recibe mercancía parcial o completa y actualiza el inventario central.",
      },
      {
        property: "og:title",
        content: "Compras y proveedores — Lula Shop OS",
      },
      {
        property: "og:description",
        content:
          "Administra proveedores y órdenes de compra; recibe mercancía parcial o completa y actualiza el inventario central.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="compras">
      <ComprasPage />
    </RequireNavAccess>
  ),
});

type Product = {
  id: string;
  name: string;
  cost: number;
  has_variants: boolean;
};

type Variant = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  cost_override: number | null;
  price_override: number | null;
};

type Line = {
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_name: string | null;
  quantity: number;
  unit_cost: number;
};

type PurchaseItem = {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  received_quantity: number;
  unit_cost: number;
  products: {
    name: string;
  } | null;
  product_variants: {
    name: string;
    sku: string | null;
  } | null;
};

function statusLabel(status: string) {
  switch (status) {
    case "ordered":
      return "Pendiente";
    case "received":
      return "Recibida";
    case "cancelled":
      return "Cancelada";
    default:
      return status;
  }
}

function statusClass(status: string) {
  switch (status) {
    case "received":
      return "text-green-600";
    case "cancelled":
      return "text-red-600";
    default:
      return "text-amber-600";
  }
}

function ComprasPage() {
  const { isManager, user } = useAuth();
  const { branchId } = useBranch();
  const qc = useQueryClient();

  const [supplierId, setSupplierId] = useState("none");
  const [lines, setLines] = useState<Line[]>([]);

  const [pick, setPick] = useState("");
  const [pickVariant, setPickVariant] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("0");

  const [sup, setSup] = useState({
    name: "",
    phone: "",
    email: "",
  });

  const [selectedPurchaseId, setSelectedPurchaseId] =
    useState<string | null>(null);

  const [receiveQty, setReceiveQty] = useState<
    Record<string, string>
  >({});

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");

      if (error) throw error;

      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, cost, has_variants")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;

      return (data ?? []) as Product[];
    },
  });

  const { data: variants = [] } = useQuery<Variant[]>({
    queryKey: ["product-variants-purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select(
          "id, product_id, name, sku, cost_override, price_override",
        )
        .order("name");

      if (error) throw error;

      return (data ?? []) as Variant[];
    },
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select(
          "id, status, total, created_at, received_at, suppliers(name)",
        )
        .eq("branch_id", branchId!)
        .order("created_at", {
          ascending: false,
        });

      if (error) throw error;

      return data ?? [];
    },
  });

  const {
    data: purchaseItems = [],
    isLoading: loadingPurchaseItems,
  } = useQuery<PurchaseItem[]>({
    queryKey: ["purchase-items", selectedPurchaseId],
    enabled: !!selectedPurchaseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_items")
        .select(
          `
            id,
            product_id,
            variant_id,
            quantity,
            received_quantity,
            unit_cost,
            products(name),
            product_variants(name, sku)
          `,
        )
        .eq("purchase_id", selectedPurchaseId!)
        .order("created_at");

      if (error) throw error;

      return (data ?? []) as unknown as PurchaseItem[];
    },
  });

  const selectedProduct = products.find(
    (p) => p.id === pick,
  );

  const productVariants = variants.filter(
    (variant) => variant.product_id === pick,
  );

  const total = lines.reduce(
    (sum, line) =>
      sum + line.quantity * line.unit_cost,
    0,
  );

  const selectedPurchase = purchases.find(
    (purchase) =>
      purchase.id === selectedPurchaseId,
  );

  const pendingItems = purchaseItems.filter(
    (item) =>
      item.received_quantity < item.quantity,
  );

  const addLine = () => {
    if (!pick) {
      toast.error("Selecciona un producto");
      return;
    }

    const quantity = Number(qty);
    const unitCost = Number(cost);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error(
        "La cantidad debe ser mayor a cero",
      );
      return;
    }

    if (!Number.isFinite(unitCost) || unitCost < 0) {
      toast.error("El costo no es válido");
      return;
    }

    const product = products.find(
      (item) => item.id === pick,
    );

    if (!product) {
      toast.error("Producto no encontrado");
      return;
    }

    const variant =
      pickVariant && pickVariant !== "none"
        ? variants.find(
            (item) => item.id === pickVariant,
          )
        : null;

    if (
      product.has_variants &&
      productVariants.length > 0 &&
      !variant
    ) {
      toast.error("Selecciona una variante");
      return;
    }

    const finalCost =
      variant?.cost_override != null
        ? variant.cost_override
        : unitCost;

    const lineName = product.name;
    const variantName = variant?.name ?? null;

    setLines((current) => {
      const existingIndex = current.findIndex(
        (line) =>
          line.product_id === product.id &&
          line.variant_id ===
            (variant?.id ?? null) &&
          line.unit_cost === finalCost,
      );

      if (existingIndex >= 0) {
        return current.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity:
                  line.quantity + quantity,
              }
            : line,
        );
      }

      return [
        ...current,
        {
          product_id: product.id,
          variant_id: variant?.id ?? null,
          name: lineName,
          variant_name: variantName,
          quantity,
          unit_cost: finalCost,
        },
      ];
    });

    setPick("");
    setPickVariant("");
    setQty("1");
    setCost("0");
  };

  const createPurchase = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error("Selecciona una sucursal");
      }

      if (!user?.id) {
        throw new Error("Sesión no válida");
      }

      if (!lines.length) {
        throw new Error(
          "Agrega al menos un producto",
        );
      }

      const { data, error } = await supabase
        .from("purchases")
        .insert({
          branch_id: branchId,
          supplier_id:
            supplierId === "none"
              ? null
              : supplierId,
          status: "ordered",
          total,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      const { error: itemsError } =
        await supabase
          .from("purchase_items")
          .insert(
            lines.map((line) => ({
              purchase_id: data.id,
              product_id: line.product_id,
              variant_id: line.variant_id,
              quantity: line.quantity,
              received_quantity: 0,
              unit_cost: line.unit_cost,
            })),
          );

      if (itemsError) {
        throw itemsError;
      }
    },

    onSuccess: () => {
      toast.success(
        "Orden de compra creada",
      );

      setLines([]);
      setSupplierId("none");

      void qc.invalidateQueries({
        queryKey: ["purchases"],
      });
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo crear la orden",
      );
    },
  });

  const receivePartial = useMutation({
    mutationFn: async () => {
      if (!selectedPurchaseId) {
        throw new Error(
          "Selecciona una compra",
        );
      }

      const items = purchaseItems
        .map((item) => {
          const pending = Math.max(
            Number(item.quantity) -
              Number(item.received_quantity),
            0,
          );

          const requested = Number(
            receiveQty[item.id] ?? 0,
          );

          return {
            item_id: item.id,
            qty: Math.min(
              Math.max(
                Number.isFinite(requested)
                  ? requested
                  : 0,
                0,
              ),
              pending,
            ),
          };
        })
        .filter((item) => item.qty > 0);

      if (!items.length) {
        throw new Error(
          "Indica al menos una cantidad pendiente para recibir",
        );
      }

      const { error } = await supabase.rpc(
        "receive_purchase_partial",
        {
          _purchase_id: selectedPurchaseId,
          _items: items,
        },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        "Recepción registrada e inventario actualizado",
      );

      setReceiveQty({});

      void qc.invalidateQueries({
        queryKey: [
          "purchase-items",
          selectedPurchaseId,
        ],
      });

      void qc.invalidateQueries({
        queryKey: ["purchases", branchId],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo registrar la recepción",
      );
    },
  });

  const receiveAll = useMutation({
    mutationFn: async (
      purchaseId: string,
    ) => {
      const { error } = await supabase.rpc(
        "receive_purchase",
        {
          _purchase_id: purchaseId,
        },
      );

      if (error) throw error;
    },

    onSuccess: (_, purchaseId) => {
      toast.success(
        "Compra recibida completa",
      );

      if (
        selectedPurchaseId === purchaseId
      ) {
        setReceiveQty({});
      }

      void qc.invalidateQueries({
        queryKey: [
          "purchase-items",
          purchaseId,
        ],
      });

      void qc.invalidateQueries({
        queryKey: ["purchases", branchId],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void qc.invalidateQueries({
        queryKey: ["inventory"],
      });
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo recibir la compra",
      );
    },
  });

  const saveSupplier = useMutation({
    mutationFn: async () => {
      const name = sup.name.trim();

      if (!name) {
        throw new Error(
          "Escribe el nombre del proveedor",
        );
      }

      const { error } = await supabase
        .from("suppliers")
        .insert({
          name,
          phone:
            sup.phone.trim() || null,
          email:
            sup.email.trim() || null,
        });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Proveedor guardado");

      setSup({
        name: "",
        phone: "",
        email: "",
      });

      void qc.invalidateQueries({
        queryKey: ["suppliers"],
      });
    },

    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el proveedor",
      );
    },
  });

  return (
    <PageShell>
      <PageHeader
        icon={Truck}
        title="Compras"
        description="Órdenes de compra y proveedores. Las recepciones entran al inventario central compartido."
      />

      <Tabs
        defaultValue="ordenes"
        className="space-y-3 sm:space-y-4"
      >
        {/* ======================================================
            TABS RESPONSIVE
            ====================================================== */}

        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="flex h-auto w-max min-w-full flex-nowrap gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm sm:w-full">
            <TabsTrigger
              value="ordenes"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs sm:text-sm"
            >
              Órdenes
            </TabsTrigger>

            <TabsTrigger
              value="proveedores"
              className="min-h-10 shrink-0 touch-manipulation rounded-lg px-4 text-xs sm:text-sm"
            >
              Proveedores
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ======================================================
            ÓRDENES
            ====================================================== */}

        <TabsContent
          value="ordenes"
          className="mt-0 grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-4"
        >
          <div className="min-w-0 space-y-3 sm:space-y-4">
            {/* LISTADO */}

            <Card className="overflow-hidden">
              <CardHeader className="p-4 sm:p-5">
                <CardTitle className="text-base sm:text-lg">
                  Órdenes de compra
                </CardTitle>
              </CardHeader>

              <CardContent className="p-0">
                {/* MÓVIL / TABLET */}

                <div className="space-y-2 p-3 lg:hidden">
                  {purchases.map((purchase) => {
                    const selected =
                      selectedPurchaseId ===
                      purchase.id;

                    return (
                      <div
                        key={purchase.id}
                        className={`rounded-xl border p-3 transition ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "bg-background"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() =>
                            setSelectedPurchaseId(
                              selected
                                ? null
                                : purchase.id,
                            )
                          }
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">
                                {shortDate(
                                  purchase.created_at,
                                )}
                              </p>

                              <p className="mt-1 truncate text-sm font-semibold">
                                {purchase
                                  .suppliers
                                  ?.name ??
                                  "Sin proveedor"}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-sm font-bold">
                                {money(
                                  purchase.total,
                                )}
                              </p>

                              <p
                                className={`mt-1 text-xs font-medium ${statusClass(
                                  purchase.status,
                                )}`}
                              >
                                {statusLabel(
                                  purchase.status,
                                )}
                              </p>
                            </div>
                          </div>
                        </button>

                        <div className="mt-3 border-t pt-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="min-h-10 w-full touch-manipulation rounded-lg"
                            onClick={() =>
                              setSelectedPurchaseId(
                                selected
                                  ? null
                                  : purchase.id,
                              )
                            }
                          >
                            {selected ? (
                              <>
                                <ChevronUp className="size-4" />
                                Cerrar gestión
                              </>
                            ) : (
                              <>
                                <ChevronDown className="size-4" />
                                Gestionar compra
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {!purchases.length && (
                    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                      Sin órdenes de compra.
                    </div>
                  )}
                </div>

                {/* ESCRITORIO */}

                <div className="hidden overflow-x-auto lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          Fecha
                        </TableHead>
                        <TableHead>
                          Proveedor
                        </TableHead>
                        <TableHead>
                          Total
                        </TableHead>
                        <TableHead>
                          Estado
                        </TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {purchases.map(
                        (purchase) => {
                          const selected =
                            selectedPurchaseId ===
                            purchase.id;

                          return (
                            <TableRow
                              key={purchase.id}
                              className={
                                selected
                                  ? "bg-muted/50"
                                  : undefined
                              }
                            >
                              <TableCell>
                                {shortDate(
                                  purchase.created_at,
                                )}
                              </TableCell>

                              <TableCell>
                                {purchase
                                  .suppliers
                                  ?.name ??
                                  "—"}
                              </TableCell>

                              <TableCell>
                                {money(
                                  purchase.total,
                                )}
                              </TableCell>

                              <TableCell>
                                <span
                                  className={`font-medium ${statusClass(
                                    purchase.status,
                                  )}`}
                                >
                                  {statusLabel(
                                    purchase.status,
                                  )}
                                </span>
                              </TableCell>

                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setSelectedPurchaseId(
                                      selected
                                        ? null
                                        : purchase.id,
                                    )
                                  }
                                >
                                  {selected ? (
                                    <>
                                      <ChevronUp className="size-4" />
                                      Cerrar
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="size-4" />
                                      Gestionar
                                    </>
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        },
                      )}

                      {!purchases.length && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-8 text-center text-muted-foreground"
                          >
                            Sin órdenes de compra.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* ==================================================
                RECEPCIÓN
                ================================================== */}

            {selectedPurchaseId && (
              <Card className="overflow-hidden">
                <CardHeader className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                        <PackageCheck className="size-5 shrink-0" />
                        <span>
                          Recepción de mercancía
                        </span>
                      </CardTitle>

                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {selectedPurchase
                          ?.suppliers?.name ??
                          "Sin proveedor"}
                      </p>
                    </div>

                    {isManager &&
                      selectedPurchase?.status !==
                        "received" &&
                      selectedPurchase?.status !==
                        "cancelled" && (
                        <Button
                          className="min-h-11 w-full touch-manipulation rounded-xl sm:w-auto sm:self-end"
                          onClick={() =>
                            receiveAll.mutate(
                              selectedPurchaseId,
                            )
                          }
                          disabled={
                            receiveAll.isPending ||
                            loadingPurchaseItems ||
                            !pendingItems.length
                          }
                        >
                          <PackageCheck className="size-4" />

                          {receiveAll.isPending
                            ? "Recibiendo..."
                            : "Recibir todo pendiente"}
                        </Button>
                      )}
                  </div>
                </CardHeader>

                <CardContent className="p-3 sm:p-5">
                  {!isManager && (
                    <p className="mb-3 rounded-xl border p-3 text-sm text-muted-foreground">
                      Tu rol puede consultar la compra, pero no registrar
                      recepciones.
                    </p>
                  )}

                  {loadingPurchaseItems ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Cargando partidas...
                    </div>
                  ) : (
                    <>
                      {/* RECEPCIÓN EN TARJETAS PARA CELULAR/TABLET */}

                      <div className="space-y-2 lg:hidden">
                        {purchaseItems.map(
                          (item) => {
                            const received =
                              Number(
                                item.received_quantity ??
                                  0,
                              );

                            const ordered =
                              Number(
                                item.quantity ?? 0,
                              );

                            const pending =
                              Math.max(
                                ordered -
                                  received,
                                0,
                              );

                            const disabled =
                              !isManager ||
                              pending <= 0 ||
                              selectedPurchase?.status ===
                                "cancelled" ||
                              selectedPurchase?.status ===
                                "received";

                            return (
                              <div
                                key={item.id}
                                className="rounded-xl border p-3"
                              >
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-semibold">
                                    {item.products
                                      ?.name ??
                                      "Producto"}
                                  </p>

                                  {item
                                    .product_variants
                                    ?.name && (
                                    <p className="mt-1 break-words text-xs text-muted-foreground">
                                      Variante:{" "}
                                      {
                                        item
                                          .product_variants
                                          .name
                                      }

                                      {item
                                        .product_variants
                                        .sku
                                        ? ` · SKU ${item.product_variants.sku}`
                                        : ""}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2">
                                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                                    <p className="text-[10px] text-muted-foreground">
                                      Pedido
                                    </p>
                                    <p className="mt-0.5 text-sm font-semibold">
                                      {ordered}
                                    </p>
                                  </div>

                                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                                    <p className="text-[10px] text-muted-foreground">
                                      Recibido
                                    </p>
                                    <p className="mt-0.5 text-sm font-semibold">
                                      {received}
                                    </p>
                                  </div>

                                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                                    <p className="text-[10px] text-muted-foreground">
                                      Pendiente
                                    </p>
                                    <p
                                      className={`mt-0.5 text-sm font-semibold ${
                                        pending > 0
                                          ? "text-amber-600"
                                          : "text-green-600"
                                      }`}
                                    >
                                      {pending}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-3">
                                  <Label className="text-xs">
                                    Cantidad a recibir
                                  </Label>

                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={
                                      receiveQty[
                                        item.id
                                      ] ?? ""
                                    }
                                    disabled={
                                      disabled
                                    }
                                    placeholder={
                                      pending >
                                      0
                                        ? String(
                                            pending,
                                          )
                                        : "0"
                                    }
                                    className="mt-1.5 h-11 rounded-xl"
                                    onChange={(
                                      event,
                                    ) => {
                                      setReceiveQty(
                                        (
                                          current,
                                        ) => ({
                                          ...current,
                                          [item.id]:
                                            event
                                              .target
                                              .value,
                                        }),
                                      );
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          },
                        )}

                        {!purchaseItems.length && (
                          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                            Esta orden no tiene partidas.
                          </div>
                        )}
                      </div>

                      {/* TABLA PARA ESCRITORIO */}

                      <div className="hidden overflow-x-auto lg:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                Producto
                              </TableHead>
                              <TableHead>
                                Pedido
                              </TableHead>
                              <TableHead>
                                Recibido
                              </TableHead>
                              <TableHead>
                                Pendiente
                              </TableHead>
                              <TableHead className="w-[150px]">
                                Recibir
                              </TableHead>
                            </TableRow>
                          </TableHeader>

                          <TableBody>
                            {purchaseItems.map(
                              (item) => {
                                const received =
                                  Number(
                                    item.received_quantity ??
                                      0,
                                  );

                                const ordered =
                                  Number(
                                    item.quantity ??
                                      0,
                                  );

                                const pending =
                                  Math.max(
                                    ordered -
                                      received,
                                    0,
                                  );

                                const disabled =
                                  !isManager ||
                                  pending <= 0 ||
                                  selectedPurchase?.status ===
                                    "cancelled" ||
                                  selectedPurchase?.status ===
                                    "received";

                                return (
                                  <TableRow
                                    key={item.id}
                                  >
                                    <TableCell>
                                      <div className="font-medium">
                                        {item
                                          .products
                                          ?.name ??
                                          "Producto"}
                                      </div>

                                      {item
                                        .product_variants
                                        ?.name && (
                                        <div className="text-xs text-muted-foreground">
                                          Variante:{" "}
                                          {
                                            item
                                              .product_variants
                                              .name
                                          }

                                          {item
                                            .product_variants
                                            .sku
                                            ? ` · SKU ${item.product_variants.sku}`
                                            : ""}
                                        </div>
                                      )}
                                    </TableCell>

                                    <TableCell>
                                      {ordered}
                                    </TableCell>

                                    <TableCell>
                                      {received}
                                    </TableCell>

                                    <TableCell>
                                      <span
                                        className={
                                          pending >
                                          0
                                            ? "font-medium text-amber-600"
                                            : "text-green-600"
                                        }
                                      >
                                        {pending}
                                      </span>
                                    </TableCell>

                                    <TableCell>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={
                                          receiveQty[
                                            item.id
                                          ] ?? ""
                                        }
                                        disabled={
                                          disabled
                                        }
                                        placeholder={
                                          pending >
                                          0
                                            ? String(
                                                pending,
                                              )
                                            : "0"
                                        }
                                        onChange={(
                                          event,
                                        ) => {
                                          setReceiveQty(
                                            (
                                              current,
                                            ) => ({
                                              ...current,
                                              [item.id]:
                                                event
                                                  .target
                                                  .value,
                                            }),
                                          );
                                        }}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              },
                            )}

                            {!purchaseItems.length && (
                              <TableRow>
                                <TableCell
                                  colSpan={5}
                                  className="py-8 text-center text-muted-foreground"
                                >
                                  Esta orden no tiene partidas.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      {isManager &&
                        selectedPurchase?.status !==
                          "received" &&
                        selectedPurchase?.status !==
                          "cancelled" &&
                        pendingItems.length >
                          0 && (
                          <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-muted-foreground sm:max-w-md sm:text-sm">
                              Puedes recibir solamente lo que llegó y dejar
                              el resto pendiente.
                            </p>

                            <Button
                              className="min-h-11 w-full touch-manipulation rounded-xl sm:w-auto"
                              onClick={() =>
                                receivePartial.mutate()
                              }
                              disabled={
                                receivePartial.isPending
                              }
                            >
                              <PackageCheck className="size-4" />

                              {receivePartial.isPending
                                ? "Registrando..."
                                : "Registrar recepción parcial"}
                            </Button>
                          </div>
                        )}

                      {selectedPurchase?.status ===
                        "received" && (
                        <p className="mt-4 rounded-xl border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700">
                          Esta compra ya fue recibida completamente.
                        </p>
                      )}

                      {selectedPurchase?.status ===
                        "cancelled" && (
                        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
                          Esta compra está cancelada y no puede recibirse.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ====================================================
              NUEVA ORDEN
              ==================================================== */}

          <Card className="h-fit overflow-hidden">
            <CardHeader className="p-4 sm:p-5">
              <CardTitle className="text-base sm:text-lg">
                Nueva orden
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 p-4 sm:p-5">
              {!isManager && (
                <p className="rounded-xl border p-3 text-sm text-muted-foreground">
                  Tu rol no puede crear compras.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Proveedor</Label>