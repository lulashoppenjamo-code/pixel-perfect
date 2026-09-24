import {
  useMemo,
  useState,
} from "react";

import {
  createFileRoute,
} from "@tanstack/react-router";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  XCircle,
} from "lucide-react";

import { toast } from "sonner";

import {
  RequireNavAccess,
} from "@/components/RequireNavAccess";

import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { supabase } from "@/integrations/supabase/client";

import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";

import { useAuth } from "@/lib/auth";

import { useBranch } from "@/lib/branch";

type ReplenishmentStatus =
  | "pending"
  | "purchased"
  | "received"
  | "cancelled";

type ReplenishmentRow = {
  id: string;
  product_id: string;
  variant_id: string | null;
  branch_id: string | null;
  requested_by: string;
  quantity: number;
  note: string | null;
  status: ReplenishmentStatus;
  created_at: string;
  updated_at: string;
  purchased_at: string | null;
  received_at: string | null;

  product: {
    name: string;
    sku: string | null;
  } | null;

  variant: {
    name: string;
    sku: string | null;
  } | null;

  requester: {
    full_name: string | null;
  } | null;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  has_variants: boolean;
  is_active: boolean;
};

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
};

type SelectedItem = {
  productId: string;
  variantId: string | null;
};

export const Route = createFileRoute(
  "/_shell/reposicion",
)({
  head: () => ({
    meta: [
      {
        title:
          "Reposición — Lula OS",
      },
      {
        name: "description",
        content:
          "Lista de productos por reponer sin modificar el inventario real.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="reposicion">
      <ReposicionPage />
    </RequireNavAccess>
  ),
});

function statusLabel(
  status: ReplenishmentStatus,
) {
  switch (status) {
    case "pending":
      return "Pendiente";

    case "purchased":
      return "Comprado";

    case "received":
      return "Recibido";

    case "cancelled":
      return "Cancelado";
  }
}

function statusVariant(
  status: ReplenishmentStatus,
) {
  if (status === "pending") {
    return "secondary" as const;
  }

  if (status === "purchased") {
    return "outline" as const;
  }

  if (status === "received") {
    return "default" as const;
  }

  return "destructive" as const;
}

function formatDate(
  value: string,
) {
  return new Intl.DateTimeFormat(
    "es-MX",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(new Date(value));
}

function ReposicionPage() {
  const { user } = useAuth();

  const {
    branchId,
  } = useBranch();

  const queryClient =
    useQueryClient();

  const [
    selectedProduct,
    setSelectedProduct,
  ] = useState("");

  const [
    selectedVariant,
    setSelectedVariant,
  ] = useState("");

  const [
    quantity,
    setQuantity,
  ] = useState("1");

  const [
    note,
    setNote,
  ] = useState("");

  const [
    search,
    setSearch,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<"all" | ReplenishmentStatus>(
      "all",
    );

  /*
   * ============================================================
   * PRODUCTOS
   * ============================================================
   */

  const {
    data: products = [],
  } = useQuery({
    queryKey: [
      "replenishment-products",
    ],

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("products")
          .select(
            "id, name, sku, barcode, has_variants, is_active",
          )
          .eq("is_active", true)
          .order("name");

      if (error) {
        throw error;
      }

      return (data ??
        []) as ProductRow[];
    },
  });

  /*
   * ============================================================
   * VARIANTES
   * ============================================================
   */

  const {
    data: variants = [],
  } = useQuery({
    queryKey: [
      "replenishment-variants",
      selectedProduct,
    ],

    enabled:
      Boolean(selectedProduct),

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from("product_variants")
          .select(
            "id, product_id, name, sku",
          )
          .eq(
            "product_id",
            selectedProduct,
          )
          .order("name");

      if (error) {
        throw error;
      }

      return (data ??
        []) as VariantRow[];
    },
  });

  /*
   * ============================================================
   * INVENTARIO
   * ============================================================
   */

  const {
    data: inventory = [],
    isLoading:
      inventoryLoading,
  } = useQuery({
    queryKey: [
      "replenishment-shared-inventory",
    ],

    queryFn:
      getSharedInventory,
  });

  /*
   * ============================================================
   * SOLICITUDES
   * ============================================================
   */

  const {
    data: requests = [],
    isLoading:
      requestsLoading,
  } = useQuery({
    queryKey: [
      "replenishment-requests",
    ],

    queryFn: async () => {
      const { data, error } =
        await (supabase as any)
          .from(
            "replenishment_requests",
          )
          .select(
            `
              id,
              product_id,
              variant_id,
              branch_id,
              requested_by,
              quantity,
              note,
              status,
              created_at,
              updated_at,
              purchased_at,
              received_at,
              product:products(
                name,
                sku
              ),
              variant:product_variants(
                name,
                sku
              ),
              requester:profiles(
                full_name
              )
            `,
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          );

      if (error) {
        throw error;
      }

      return (data ??
        []) as ReplenishmentRow[];
    },
  });

  /*
   * ============================================================
   * PRODUCTOS BAJO MÍNIMO
   * ============================================================
   */

  const lowStock =
    useMemo(() => {
      return inventory.filter(
        (row) =>
          Number(
            row.available_stock,
          ) <=
          Number(row.min_stock),
      );
    }, [inventory]);

  const outOfStock =
    useMemo(() => {
      return inventory.filter(
        (row) =>
          Number(
            row.available_stock,
          ) <= 0,
      );
    }, [inventory]);

  /*
   * ============================================================
   * PRODUCTOS FILTRADOS
   * ============================================================
   */

  const filteredProducts =
    useMemo(() => {
      const term =
        search
          .trim()
          .toLowerCase();

      if (!term) {
        return products.slice(
          0,
          80,
        );
      }

      return products
        .filter((product) => {
          return (
            product.name
              .toLowerCase()
              .includes(term) ||
            product.sku
              ?.toLowerCase()
              .includes(term) ||
            product.barcode
              ?.toLowerCase()
              .includes(term)
          );
        })
        .slice(0, 80);
    }, [products, search]);

  /*
   * ============================================================
   * SOLICITUDES FILTRADAS
   * ============================================================
   */

  const filteredRequests =
    useMemo(() => {
      const term =
        search
          .trim()
          .toLowerCase();

      return requests.filter(
        (request) => {
          const matchesStatus =
            statusFilter === "all" ||
            request.status ===
              statusFilter;

          const productName =
            request.product
              ?.name ??
            "";

          const variantName =
            request.variant
              ?.name ??
            "";

          const matchesSearch =
            !term ||
            productName
              .toLowerCase()
              .includes(term) ||
            variantName
              .toLowerCase()
              .includes(term) ||
            request.product?.sku
              ?.toLowerCase()
              .includes(term) ||
            request.variant?.sku
              ?.toLowerCase()
              .includes(term);

          return (
            matchesStatus &&
            matchesSearch
          );
        },
      );
    }, [
      requests,
      search,
      statusFilter,
    ]);

  /*
   * ============================================================
   * RESUMEN
   * ============================================================
   */

  const pendingRequests =
    requests.filter(
      (request) =>
        request.status ===
        "pending",
    );

  const purchasedRequests =
    requests.filter(
      (request) =>
        request.status ===
        "purchased",
    );

  const receivedRequests =
    requests.filter(
      (request) =>
        request.status ===
        "received",
    );

  /*
   * ============================================================
   * AGREGACIÓN SEMANAL
   * ============================================================
   */

  const weeklyAggregation =
    useMemo(() => {
      const map =
        new Map<
          string,
          {
            name: string;
            variant: string | null;
            quantity: number;
          }
        >();

      for (const request of requests) {
        if (
          request.status ===
            "received" ||
          request.status ===
            "cancelled"
        ) {
          continue;
        }

        const key = [
          request.product_id,
          request.variant_id ??
            "base",
        ].join(":");

        const current =
          map.get(key);

        const name =
          request.product
            ?.name ??
          "Producto";

        const variant =
          request.variant
            ?.name ??
          null;

        if (current) {
          current.quantity +=
            Number(
              request.quantity,
            );
        } else {
          map.set(key, {
            name,
            variant,
            quantity:
              Number(
                request.quantity,
              ),
          });
        }
      }

      return Array.from(
        map.values(),
      ).sort(
        (a, b) =>
          b.quantity -
          a.quantity,
      );
    }, [requests]);

  /*
   * ============================================================
   * CREAR SOLICITUD
   * ============================================================
   */

  const createRequest =
    useMutation({
      mutationFn:
        async () => {
          if (!user?.id) {
            throw new Error(
              "No hay usuario autenticado.",
            );
          }

          if (!selectedProduct) {
            throw new Error(
              "Selecciona un producto.",
            );
          }

          const parsedQuantity =
            Number(quantity);

          if (
            !Number.isFinite(
              parsedQuantity,
            ) ||
            parsedQuantity <= 0
          ) {
            throw new Error(
              "La cantidad debe ser mayor que cero.",
            );
          }

          const { error } =
            await (supabase as any)
              .from(
                "replenishment_requests",
              )
              .insert({
                product_id:
                  selectedProduct,

                variant_id:
                  selectedVariant ||
                  null,

                branch_id:
                  branchId || null,

                requested_by:
                  user.id,

                quantity:
                  parsedQuantity,

                note:
                  note.trim() ||
                  null,

                status:
                  "pending",
              });

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Producto agregado a reposición.",
        );

        setSelectedProduct("");
        setSelectedVariant("");
        setQuantity("1");
        setNote("");

        void queryClient.invalidateQueries(
          {
            queryKey: [
              "replenishment-requests",
            ],
          },
        );
      },

      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo crear la solicitud.",
        );
      },
    });

  /*
   * ============================================================
   * CAMBIAR ESTADO
   * ============================================================
   */

  const updateStatus =
    useMutation({
      mutationFn:
        async ({
          id,
          status,
        }: {
          id: string;
          status: ReplenishmentStatus;
        }) => {
          const values: Record<
            string,
            unknown
          > = {
            status,
          };

          if (
            status ===
            "purchased"
          ) {
            values.purchased_at =
              new Date().toISOString();
          }

          if (
            status ===
            "received"
          ) {
            values.received_at =
              new Date().toISOString();
          }

          const { error } =
            await (supabase as any)
              .from(
                "replenishment_requests",
              )
              .update(values)
              .eq("id", id);

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Estado actualizado.",
        );

        void queryClient.invalidateQueries(
          {
            queryKey: [
              "replenishment-requests",
            ],
          },
        );
      },

      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo actualizar.",
        );
      },
    });

  /*
   * ============================================================
   * CAMBIAR CANTIDAD
   * ============================================================
   */

  const updateQuantity =
    useMutation({
      mutationFn:
        async ({
          id,
          quantity,
        }: {
          id: string;
          quantity: number;
        }) => {
          if (
            !Number.isFinite(
              quantity,
            ) ||
            quantity <= 0
          ) {
            throw new Error(
              "Cantidad inválida.",
            );
          }

          const { error } =
            await (supabase as any)
              .from(
                "replenishment_requests",
              )
              .update({
                quantity,
              })
              .eq("id", id);

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Cantidad actualizada.",
        );

        void queryClient.invalidateQueries(
          {
            queryKey: [
              "replenishment-requests",
            ],
          },
        );
      },

      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo actualizar.",
        );
      },
    });

  /*
   * ============================================================
   * AGREGAR PRODUCTO AUTOMÁTICAMENTE
   * ============================================================
   */

  const addSuggested =
    useMutation({
      mutationFn:
        async (
          row: SharedInventoryRow,
        ) => {
          if (!user?.id) {
            throw new Error(
              "No hay usuario autenticado.",
            );
          }

          const existing =
            requests.find(
              (request) =>
                request.product_id ===
                  row.product_id &&
                request.variant_id ===
                  row.variant_id &&
                request.status ===
                  "pending",
            );

          if (existing) {
            throw new Error(
              "Este producto ya está pendiente de reposición.",
            );
          }

          const current =
            Number(
              row.available_stock,
            );

          const minimum =
            Number(
              row.min_stock,
            );

          let suggested =
            minimum > current
              ? minimum - current
              : 1;

          if (
            row.max_stock !==
              null &&
            Number(
              row.max_stock,
            ) > current
          ) {
            suggested = Math.max(
              suggested,
              Number(
                row.max_stock,
              ) - current,
            );
          }

          suggested =
            Math.max(
              Math.ceil(
                suggested,
              ),
              1,
            );

          const { error } =
            await (supabase as any)
              .from(
                "replenishment_requests",
              )
              .insert({
                product_id:
                  row.product_id,

                variant_id:
                  row.variant_id,

                branch_id:
                  branchId || null,

                requested_by:
                  user.id,

                quantity:
                  suggested,

                note:
                  "Sugerencia automática por stock bajo.",
                status:
                  "pending",
              });

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Agregado a reposición.",
        );

        void queryClient.invalidateQueries(
          {
            queryKey: [
              "replenishment-requests",
            ],
          },
        );
      },

      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo agregar.",
        );
      },
    });

  const selectedProductData =
    products.find(
      (product) =>
        product.id ===
        selectedProduct,
    );

  const hasVariants =
    Boolean(
      selectedProductData?.has_variants,
    );

  return (
    <PageShell>
      <PageHeader
  title="Reposición"
  description="Lista de productos que hacen falta comprar. No modifica el inventario real."
  icon={ShoppingCart}
/>
      {/* ======================================================
          RESUMEN
      ======================================================= */}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Pendientes
                </p>

                <p className="text-2xl font-bold">
                  {pendingRequests.length}
                </p>
              </div>

              <Clock3 className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Comprados
                </p>

                <p className="text-2xl font-bold">
                  {purchasedRequests.length}
                </p>
              </div>

              <ShoppingCart className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Recibidos
                </p>

                <p className="text-2xl font-bold">
                  {receivedRequests.length}
                </p>
              </div>

              <PackageCheck className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Bajo mínimo
                </p>

                <p className="text-2xl font-bold">
                  {lowStock.length}
                </p>
              </div>

              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Agotados
                </p>

                <p className="text-2xl font-bold">
                  {outOfStock.length}
                </p>
              </div>

              <XCircle className="h-5 w-5 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ======================================================
          AGREGAR MANUALMENTE
      ======================================================= */}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Agregar producto a reposición
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[2fr_1.5fr_120px_2fr_auto]">
            <div className="space-y-1.5">
              <Label>
                Producto
              </Label>

              <Select
                value={
                  selectedProduct
                }
                onValueChange={(
                  value,
                ) => {
                  setSelectedProduct(
                    value,
                  );
                  setSelectedVariant(
                    "",
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona producto" />
                </SelectTrigger>

                <SelectContent>
                  {filteredProducts.map(
                    (product) => (
                      <SelectItem
                        key={
                          product.id
                        }
                        value={
                          product.id
                        }
                      >
                        {product.name}
                        {product.sku
                          ? ` — ${product.sku}`
                          : ""}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Variante
              </Label>

              <Select
                value={
                  selectedVariant
                }
                onValueChange={
                  setSelectedVariant
                }
                disabled={
                  !selectedProduct ||
                  !hasVariants
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      hasVariants
                        ? "Selecciona variante"
                        : "Sin variante"
                    }
                  />
                </SelectTrigger>

                <SelectContent>
                  {variants.map(
                    (variant) => (
                      <SelectItem
                        key={
                          variant.id
                        }
                        value={
                          variant.id
                        }
                      >
                        {variant.name}
                        {variant.sku
                          ? ` — ${variant.sku}`
                          : ""}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Cantidad
              </Label>

              <Input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(
                  event,
                ) =>
                  setQuantity(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Nota
              </Label>

              <Input
                value={note}
                onChange={(
                  event,
                ) =>
                  setNote(
                    event.target
                      .value,
                  )
                }
                placeholder="Ej. Se está terminando..."
              />
            </div>

            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={
                  createRequest.isPending ||
                  !selectedProduct
                }
                onClick={() =>
                  createRequest.mutate()
                }
              >
                {createRequest.isPending
                  ? "Agregando..."
                  : "Agregar"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ======================================================
          SUGERENCIAS
      ======================================================= */}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            Sugerencias automáticas
          </CardTitle>

          <p className="text-xs text-muted-foreground">
            Productos agotados o debajo de su mínimo configurado.
            Agregarlos aquí solamente crea una solicitud de compra.
          </p>
        </CardHeader>

        <CardContent>
          {inventoryLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Revisando inventario...
            </p>
          ) : lowStock.length ===
            0 ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />

              <p className="font-medium">
                No hay productos bajo mínimo.
              </p>

              <p className="text-sm text-muted-foreground">
                El inventario está dentro de los límites configurados.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Producto
                    </TableHead>

                    <TableHead>
                      Stock
                    </TableHead>

                    <TableHead>
                      Mínimo
                    </TableHead>

                    <TableHead>
                      Sugerencia
                    </TableHead>

                    <TableHead />
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {lowStock
                    .slice(0, 30)
                    .map((row) => {
                      const current =
                        Number(
                          row.available_stock,
                        );

                      const minimum =
                        Number(
                          row.min_stock,
                        );

                      let suggested =
                        minimum >
                        current
                          ? minimum -
                            current
                          : 1;

                      if (
                        row.max_stock !==
                          null &&
                        Number(
                          row.max_stock,
                        ) > current
                      ) {
                        suggested =
                          Math.max(
                            suggested,
                            Number(
                              row.max_stock,
                            ) -
                              current,
                          );
                      }

                      suggested =
                        Math.max(
                          Math.ceil(
                            suggested,
                          ),
                          1,
                        );

                      const alreadyPending =
                        requests.some(
                          (request) =>
                            request.product_id ===
                              row.product_id &&
                            request.variant_id ===
                              row.variant_id &&
                            request.status ===
                              "pending",
                        );

                      return (
                        <TableRow
                          key={`${row.product_id}-${row.variant_id ?? "base"}`}
                        >
                          <TableCell className="font-medium">
                            {row.product_name}

                            {row.variant_id && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Variante
                              </span>
                            )}
                          </TableCell>

                          <TableCell>
                            <Badge
                              variant={
                                Number(
                                  row.available_stock,
                                ) <= 0
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {Number(
                                row.available_stock,
                              )}
                            </Badge>
                          </TableCell>

                          <TableCell>
                            {minimum}
                          </TableCell>

                          <TableCell className="font-semibold">
                            {suggested}
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                alreadyPending ||
                                addSuggested.isPending
                              }
                              onClick={() =>
                                addSuggested.mutate(
                                  row,
                                )
                              }
                            >
                              {alreadyPending
                                ? "Ya pendiente"
                                : "Agregar"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          LISTA SEMANAL
      ======================================================= */}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            Lista semanal de compra
          </CardTitle>

          <p className="text-xs text-muted-foreground">
            Se agrupan automáticamente las solicitudes pendientes y compradas.
          </p>
        </CardHeader>

        <CardContent>
          {weeklyAggregation.length ===
          0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay productos pendientes de compra.
            </p>
          ) : (
            <div className="space-y-2">
              {weeklyAggregation.map(
                (item, index) => (
                  <div
                    key={`${item.name}-${item.variant ?? "base"}-${index}`}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        {item.name}
                      </p>

                      {item.variant && (
                        <p className="text-xs text-muted-foreground">
                          {item.variant}
                        </p>
                      )}
                    </div>

                    <Badge variant="secondary">
                      {item.quantity}{" "}
                      {item.quantity ===
                      1
                        ? "pieza"
                        : "piezas"}
                    </Badge>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================================================
          HISTORIAL / SOLICITUDES
      ======================================================= */}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">
                Solicitudes de reposición
              </CardTitle>

              <p className="text-xs text-muted-foreground">
                El cambio a "Recibido" no modifica existencias.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={search}
                  onChange={(
                    event,
                  ) =>
                    setSearch(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Buscar producto..."
                  className="pl-9"
                />
              </div>

              <Select
                value={
                  statusFilter
                }
                onValueChange={(
                  value,
                ) =>
                  setStatusFilter(
                    value as
                      | "all"
                      | ReplenishmentStatus,
                  )
                }
              >
                <SelectTrigger className="w-full sm:w-[170px]">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="all">
                    Todos
                  </SelectItem>

                  <SelectItem value="pending">
                    Pendientes
                  </SelectItem>

                  <SelectItem value="purchased">
                    Comprados
                  </SelectItem>

                  <SelectItem value="received">
                    Recibidos
                  </SelectItem>

                  <SelectItem value="cancelled">
                    Cancelados
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          {requestsLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Cargando solicitudes...
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    Producto
                  </TableHead>

                  <TableHead>
                    Cantidad
                  </TableHead>

                  <TableHead>
                    Estado
                  </TableHead>

                  <TableHead>
                    Nota
                  </TableHead>

                  <TableHead>
                    Solicitó
                  </TableHead>

                  <TableHead>
                    Fecha
                  </TableHead>

                  <TableHead className="text-right">
                    Acción
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredRequests.map(
                  (request) => (
                    <TableRow
                      key={request.id}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {request
                              .product
                              ?.name ??
                              "Producto"}
                          </p>

                          {request
                            .variant
                            ?.name && (
                            <p className="text-xs text-muted-foreground">
                              {
                                request
                                  .variant
                                  .name
                              }
                            </p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        {request.status ===
                        "pending" ? (
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            defaultValue={String(
                              request.quantity,
                            )}
                            className="w-20"
                            onBlur={(
                              event,
                            ) => {
                              const next =
                                Number(
                                  event
                                    .target
                                    .value,
                                );

                              if (
                                next !==
                                Number(
                                  request.quantity,
                                )
                              ) {
                                updateQuantity.mutate(
                                  {
                                    id: request.id,
                                    quantity:
                                      next,
                                  },
                                );
                              }
                            }}
                          />
                        ) : (
                          Number(
                            request.quantity,
                          )
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant={statusVariant(
                            request.status,
                          )}
                        >
                          {statusLabel(
                            request.status,
                          )}
                        </Badge>
                      </TableCell>

                      <TableCell className="max-w-[220px]">
                        <span className="block truncate text-xs text-muted-foreground">
                          {request.note ??
                            "—"}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span className="text-xs">
                          {request
                            .requester
                            ?.full_name ||
                            "Usuario"}
                        </span>
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDate(
                          request.created_at,
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {request.status ===
                            "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  updateStatus.isPending
                                }
                                onClick={() =>
                                  updateStatus.mutate(
                                    {
                                      id: request.id,
                                      status:
                                        "purchased",
                                    },
                                  )
                                }
                              >
                                Comprado
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  updateStatus.isPending
                                }
                                onClick={() =>
                                  updateStatus.mutate(
                                    {
                                      id: request.id,
                                      status:
                                        "cancelled",
                                    },
                                  )
                                }
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {request.status ===
                            "purchased" && (
                            <Button
                              size="sm"
                              disabled={
                                updateStatus.isPending
                              }
                              onClick={() =>
                                updateStatus.mutate(
                                  {
                                    id: request.id,
                                    status:
                                      "received",
                                  },
                                )
                              }
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Recibido
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}

                {filteredRequests.length ===
                  0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No hay solicitudes que coincidan.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}