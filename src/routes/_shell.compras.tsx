import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(
    null,
  );

  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

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
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data ?? [];
    },
  });

  const { data: purchaseItems = [], isLoading: loadingPurchaseItems } =
    useQuery<PurchaseItem[]>({
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

  const selectedProduct = products.find((p) => p.id === pick);

  const productVariants = variants.filter(
    (variant) => variant.product_id === pick,
  );

  const total = lines.reduce(
    (sum, line) => sum + line.quantity * line.unit_cost,
    0,
  );

  const selectedPurchase = purchases.find(
    (purchase) => purchase.id === selectedPurchaseId,
  );

  const pendingItems = purchaseItems.filter(
    (item) => item.received_quantity < item.quantity,
  );

  const addLine = () => {
    if (!pick) {
      toast.error("Selecciona un producto");
      return;
    }

    const quantity = Number(qty);
    const unitCost = Number(cost);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("La cantidad debe ser mayor a cero");
      return;
    }

    if (!Number.isFinite(unitCost) || unitCost < 0) {
      toast.error("El costo no es válido");
      return;
    }

    const product = products.find((item) => item.id === pick);

    if (!product) {
      toast.error("Producto no encontrado");
      return;
    }

    const variant =
      pickVariant && pickVariant !== "none"
        ? variants.find((item) => item.id === pickVariant)
        : null;

    if (product.has_variants && productVariants.length > 0 && !variant) {
      toast.error("Selecciona una variante");
      return;
    }

    const finalCost =
      variant?.cost_override != null ? variant.cost_override : unitCost;

    const lineName = product.name;
    const variantName = variant?.name ?? null;

    setLines((current) => {
      const existingIndex = current.findIndex(
        (line) =>
          line.product_id === product.id &&
          line.variant_id === (variant?.id ?? null) &&
          line.unit_cost === finalCost,
      );

      if (existingIndex >= 0) {
        return current.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity: line.quantity + quantity,
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
        throw new Error("Agrega al menos un producto");
      }

      const { data, error } = await supabase
        .from("purchases")
        .insert({
          branch_id: branchId,
          supplier_id: supplierId === "none" ? null : supplierId,
          status: "ordered",
          total,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      const { error: itemsError } = await supabase
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
      toast.success("Orden de compra creada");

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
        throw new Error("Selecciona una compra");
      }

      const items = purchaseItems
        .map((item) => {
          const pending = Math.max(
            Number(item.quantity) - Number(item.received_quantity),
            0,
          );

          const requested = Number(receiveQty[item.id] ?? 0);

          return {
            item_id: item.id,
            qty: Math.min(
              Math.max(Number.isFinite(requested) ? requested : 0, 0),
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

      const { error } = await supabase.rpc("receive_purchase_partial", {
        _purchase_id: selectedPurchaseId,
        _items: items,
      });

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Recepción registrada e inventario actualizado");

      setReceiveQty({});

      void qc.invalidateQueries({
        queryKey: ["purchase-items", selectedPurchaseId],
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
    mutationFn: async (purchaseId: string) => {
      const { error } = await supabase.rpc("receive_purchase", {
        _purchase_id: purchaseId,
      });

      if (error) throw error;
    },

    onSuccess: (_, purchaseId) => {
      toast.success("Compra recibida completa");

      if (selectedPurchaseId === purchaseId) {
        setReceiveQty({});
      }

      void qc.invalidateQueries({
        queryKey: ["purchase-items", purchaseId],
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
        throw new Error("Escribe el nombre del proveedor");
      }

      const { error } = await supabase.from("suppliers").insert({
        name,
        phone: sup.phone.trim() || null,
        email: sup.email.trim() || null,
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

      <Tabs defaultValue="ordenes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
          <TabsTrigger value="proveedores">Proveedores</TabsTrigger>
        </TabsList>

        <TabsContent
          value="ordenes"
          className="grid gap-4 lg:grid-cols-[1fr_380px]"
        >
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Órdenes de compra</CardTitle>
              </CardHeader>

              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {purchases.map((purchase) => {
                      const selected =
                        selectedPurchaseId === purchase.id;

                      return (
                        <TableRow
                          key={purchase.id}
                          className={
                            selected ? "bg-muted/50" : undefined
                          }
                        >
                          <TableCell>
                            {shortDate(purchase.created_at)}
                          </TableCell>

                          <TableCell>
                            {purchase.suppliers?.name ?? "—"}
                          </TableCell>

                          <TableCell>
                            {money(purchase.total)}
                          </TableCell>

                          <TableCell>
                            <span
                              className={`font-medium ${statusClass(
                                purchase.status,
                              )}`}
                            >
                              {statusLabel(purchase.status)}
                            </span>
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setSelectedPurchaseId(
                                  selected ? null : purchase.id,
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
                    })}

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
              </CardContent>
            </Card>

            {selectedPurchaseId && (
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <PackageCheck className="size-5" />
                        Recepción de mercancía
                      </CardTitle>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedPurchase?.suppliers?.name ??
                          "Sin proveedor"}
                      </p>
                    </div>

                    {isManager &&
                      selectedPurchase?.status !== "received" &&
                      selectedPurchase?.status !== "cancelled" && (
                        <Button
                          onClick={() =>
                            receiveAll.mutate(selectedPurchaseId)
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

                <CardContent className="space-y-4">
                  {!isManager && (
                    <p className="rounded-md border p-3 text-sm text-muted-foreground">
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
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Producto</TableHead>
                              <TableHead>Pedido</TableHead>
                              <TableHead>Recibido</TableHead>
                              <TableHead>Pendiente</TableHead>
                              <TableHead className="w-[150px]">
                                Recibir
                              </TableHead>
                            </TableRow>
                          </TableHeader>

                          <TableBody>
                            {purchaseItems.map((item) => {
                              const received = Number(
                                item.received_quantity ?? 0,
                              );

                              const ordered = Number(item.quantity ?? 0);

                              const pending = Math.max(
                                ordered - received,
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
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {item.products?.name ?? "Producto"}
                                    </div>

                                    {item.product_variants?.name && (
                                      <div className="text-xs text-muted-foreground">
                                        Variante:{" "}
                                        {item.product_variants.name}
                                        {item.product_variants.sku
                                          ? ` · SKU ${item.product_variants.sku}`
                                          : ""}
                                      </div>
                                    )}
                                  </TableCell>

                                  <TableCell>{ordered}</TableCell>

                                  <TableCell>{received}</TableCell>

                                  <TableCell>
                                    <span
                                      className={
                                        pending > 0
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
                                      value={receiveQty[item.id] ?? ""}
                                      disabled={disabled}
                                      placeholder={
                                        pending > 0 ? String(pending) : "0"
                                      }
                                      onChange={(event) => {
                                        setReceiveQty((current) => ({
                                          ...current,
                                          [item.id]: event.target.value,
                                        }));
                                      }}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}

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
                        selectedPurchase?.status !== "received" &&
                        selectedPurchase?.status !== "cancelled" &&
                        pendingItems.length > 0 && (
                          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                              Puedes recibir solamente lo que llegó y dejar
                              el resto pendiente.
                            </p>

                            <Button
                              onClick={() => receivePartial.mutate()}
                              disabled={receivePartial.isPending}
                            >
                              <PackageCheck className="size-4" />
                              {receivePartial.isPending
                                ? "Registrando..."
                                : "Registrar recepción parcial"}
                            </Button>
                          </div>
                        )}

                      {selectedPurchase?.status === "received" && (
                        <p className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700">
                          Esta compra ya fue recibida completamente.
                        </p>
                      )}

                      {selectedPurchase?.status === "cancelled" && (
                        <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
                          Esta compra está cancelada y no puede recibirse.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Nueva orden</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {!isManager && (
                <p className="text-sm text-muted-foreground">
                  Tu rol no puede crear compras.
                </p>
              )}

              <div className="space-y-2">
                <Label>Proveedor</Label>

                <Select
                  value={supplierId}
                  onValueChange={setSupplierId}
                  disabled={!isManager}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona proveedor" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="none">
                      Sin proveedor
                    </SelectItem>

                    {suppliers.map((supplier) => (
                      <SelectItem
                        key={supplier.id}
                        value={supplier.id}
                      >
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Producto</Label>

                <Select
                  value={pick}
                  disabled={!isManager}
                  onValueChange={(value) => {
                    const product = products.find(
                      (item) => item.id === value,
                    );

                    setPick(value);
                    setPickVariant("");

                    setCost(
                      String(
                        product?.cost ?? 0,
                      ),
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un producto" />
                  </SelectTrigger>

                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem
                        key={product.id}
                        value={product.id}
                      >
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProduct &&
                selectedProduct.has_variants &&
                productVariants.length > 0 && (
                  <div className="space-y-2">
                    <Label>Variante</Label>

                    <Select
                      value={pickVariant}
                      disabled={!isManager}
                      onValueChange={(value) => {
                        setPickVariant(value);

                        const variant = productVariants.find(
                          (item) => item.id === value,
                        );

                        if (
                          variant?.cost_override != null
                        ) {
                          setCost(
                            String(
                              variant.cost_override,
                            ),
                          );
                        } else {
                          setCost(
                            String(
                              selectedProduct.cost,
                            ),
                          );
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elige una variante" />
                      </SelectTrigger>

                      <SelectContent>
                        {productVariants.map((variant) => (
                          <SelectItem
                            key={variant.id}
                            value={variant.id}
                          >
                            {variant.name}
                            {variant.sku
                              ? ` · ${variant.sku}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Cantidad</Label>

                  <Input
                    type="number"
                    min="0.01"
                    step="any"
                    value={qty}
                    disabled={!isManager}
                    onChange={(event) =>
                      setQty(event.target.value)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Costo unitario</Label>

                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cost}
                    disabled={!isManager}
                    onChange={(event) =>
                      setCost(event.target.value)
                    }
                  />
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                disabled={!isManager || !pick}
                onClick={addLine}
              >
                <Plus className="size-4" />
                Agregar partida
              </Button>

              {lines.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  {lines.map((line, index) => (
                    <div
                      key={`${line.product_id}-${line.variant_id}-${index}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {line.quantity} × {line.name}
                        </div>

                        {line.variant_name && (
                          <div className="truncate text-xs text-muted-foreground">
                            {line.variant_name}
                          </div>
                        )}
                      </div>

                      <span className="shrink-0">
                        {money(
                          line.quantity *
                            line.unit_cost,
                        )}
                      </span>

                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!isManager}
                        onClick={() =>
                          setLines((current) =>
                            current.filter(
                              (_, lineIndex) =>
                                lineIndex !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between border-t pt-3 font-semibold">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>

              <Button
                className="w-full"
                disabled={
                  !isManager ||
                  !lines.length ||
                  createPurchase.isPending
                }
                onClick={() =>
                  createPurchase.mutate()
                }
              >
                {createPurchase.isPending
                  ? "Creando..."
                  : "Crear orden"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="proveedores"
          className="grid gap-4 lg:grid-cols-[1fr_340px]"
        >
          <Card>
            <CardHeader>
              <CardTitle>Proveedores</CardTitle>
            </CardHeader>

            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Correo</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {suppliers.map((supplier) => (
                    <TableRow key={supplier.id}>
                      <TableCell>{supplier.name}</TableCell>
                      <TableCell>
                        {supplier.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        {supplier.email ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}

                  {!suppliers.length && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Aún no hay proveedores.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Nuevo proveedor</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Nombre</Label>

                <Input
                  value={sup.name}
                  disabled={!isManager}
                  onChange={(event) =>
                    setSup({
                      ...sup,
                      name: event.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Teléfono</Label>

                <Input
                  value={sup.phone}
                  disabled={!isManager}
                  onChange={(event) =>
                    setSup({
                      ...sup,
                      phone: event.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Correo</Label>

                <Input
                  type="email"
                  value={sup.email}
                  disabled={!isManager}
                  onChange={(event) =>
                    setSup({
                      ...sup,
                      email: event.target.value,
                    })
                  }
                />
              </div>

              <Button
                className="w-full"
                disabled={
                  !isManager ||
                  !sup.name.trim() ||
                  saveSupplier.isPending
                }
                onClick={() =>
                  saveSupplier.mutate()
                }
              >
                {saveSupplier.isPending
                  ? "Guardando..."
                  : "Guardar"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}