import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
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
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";
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
   *
   * Las dos tiendas utilizan la misma existencia.
   * No se consulta inventory.branch_id.
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

      /*
       * Si existen variantes, cada fila corresponde a una variante.
       * Para el selector simple mostramos la existencia total
       * del producto.
       */
      map.set(
        row.product_id,
        current + Number(row.available_stock ?? 0),
      );
    }

    return map;
  }, [sharedInventory]);

  /*
   * ============================================================
   * PRODUCTOS DISPONIBLES PARA PEDIDO
   * ============================================================
   */

  const selectableProducts = useMemo(() => {
    return products.filter((product) => {
      return (stockByProduct.get(product.id) ?? 0) > 0;
    });
  }, [products, stockByProduct]);

  /*
   * ============================================================
   * AGREGAR PRODUCTO
   * ============================================================
   */

  const addLine = () => {
    const product = products.find(
      (item) => item.id === pickProduct,
    );

    if (!product) {
      toast.error("Selecciona un producto");
      return;
    }

    const available = stockByProduct.get(product.id) ?? 0;

    if (available <= 0) {
      toast.error("Producto sin existencia disponible");
      return;
    }

    const quantity = Math.max(
      1,
      Number(pickQty) || 1,
    );

    setLines((previous) => {
      const existing = previous.find(
        (line) => line.product_id === product.id,
      );

      if (existing) {
        const newQuantity =
          existing.quantity + quantity;

        if (newQuantity > available) {
          toast.error(
            `Solo hay ${available} disponibles`,
          );

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
          toast.error(
            `Solo hay ${line.available_stock} disponibles`,
          );

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
      previous.filter(
        (line) => line.product_id !== productId,
      ),
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
        (total, line) =>
          total +
          line.unit_price * line.quantity,
        0,
      ),
    [lines],
  );

  /*
   * ============================================================
   * CREAR PEDIDO
   *
   * La RPC create_online_order es la responsable de reservar
   * el stock central.
   * ============================================================
   */

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!branchId) {
        throw new Error("No hay sucursal activa");
      }

      if (!lines.length) {
        throw new Error(
          "Agrega al menos un producto",
        );
      }

      /*
       * Última validación local antes de enviar.
       */
      for (const line of lines) {
        const currentStock =
          stockByProduct.get(line.product_id) ?? 0;

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

      const { data, error } =
        await supabase.rpc(
          "create_online_order",
          {
            _branch_id: branchId,
            _items: items,
            ...(customerName.trim()
              ? {
                  _customer_name:
                    customerName.trim(),
                }
              : {}),
            ...(customerPhone.trim()
              ? {
                  _customer_phone:
                    customerPhone.trim(),
                }
              : {}),
            ...(address.trim()
              ? {
                  _delivery_address:
                    address.trim(),
                }
              : {}),
            ...(notes.trim()
              ? {
                  _notes: notes.trim(),
                }
              : {}),
          },
        );

      if (error) throw error;

      return data;
    },

    onSuccess: () => {
      toast.success(
        "Pedido creado y stock reservado",
      );

      closeCreateDialog();

      void qc.invalidateQueries({
        queryKey: ["online-orders"],
      });

      void qc.invalidateQueries({
        queryKey: ["shared-inventory"],
      });

      void qc.invalidateQueries({
        queryKey: ["pos-products-shared"],
      });

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
   *
   * La RPC consume la reserva del inventario central.
   * ============================================================
   */

  const fulfill = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc(
        "fulfill_online_order",
        {
          _order_id: orderId,
        },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        "Pedido entregado y stock descontado",
      );

      void invalidateOperationalQueries();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  /*
   * ============================================================
   * CANCELAR
   *
   * La RPC libera la reserva del inventario central.
   * ============================================================
   */

  const cancel = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc(
        "cancel_online_order",
        {
          _order_id: orderId,
        },
      );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success(
        "Pedido cancelado y reserva liberada",
      );

      void invalidateOperationalQueries();
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const invalidateOperationalQueries =
    async () => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ["online-orders"],
        }),
        qc.invalidateQueries({
          queryKey: ["shared-inventory"],
        }),
        qc.invalidateQueries({
          queryKey: ["pos-products-shared"],
        }),
        qc.invalidateQueries({
          queryKey: ["pos-variant-inventory-shared"],
        }),
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
    return (
      <Badge
        variant={
          STATUS_VARIANT[status] ??
          "outline"
        }
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
      order.status !== "delivered" &&
      order.status !== "cancelled",
  ).length;

  const reservedOrders = orders.filter(
    (order) =>
      order.status !== "delivered" &&
      order.status !== "cancelled",
  );

  const reservedValue = reservedOrders.reduce(
    (total, order) =>
      total + Number(order.total),
    0,
  );

  return (
    <PageShell>
      <PageHeader
        icon={Store}
        title="Pedidos online"
        description="Pedidos conectados al catálogo e inventario central de Lula OS."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void invalidateOperationalQueries();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Actualizar
            </Button>

            <Button
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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Pedidos activos
            </p>
            <p className="mt-1 text-2xl font-bold">
              {pendingOrders}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Valor reservado
            </p>
            <p className="mt-1 text-2xl font-bold">
              {money(reservedValue)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Productos disponibles
            </p>
            <p className="mt-1 text-2xl font-bold">
              {selectableProducts.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Órdenes recientes
          </CardTitle>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loadingOrders && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Cargando pedidos...
                  </TableCell>
                </TableRow>
              )}

              {!loadingOrders &&
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {shortDate(
                        order.created_at,
                      )}
                    </TableCell>

                    <TableCell className="font-medium">
                      {order.customer_name ??
                        "Cliente online"}
                    </TableCell>

                    <TableCell className="text-sm">
                      {order.customer_phone ??
                        "—"}
                    </TableCell>

                    <TableCell className="max-w-[220px] truncate text-sm">
                      {order.delivery_address ??
                        "—"}
                    </TableCell>

                    <TableCell className="font-medium">
                      {money(
                        Number(order.total),
                      )}
                    </TableCell>

                    <TableCell>
                      {statusBadge(
                        order.status,
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      {order.status !==
                        "delivered" &&
                        order.status !==
                          "cancelled" &&
                        isManager && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                fulfill.isPending ||
                                cancel.isPending
                              }
                              onClick={() =>
                                fulfill.mutate(
                                  order.id,
                                )
                              }
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Entregar
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={
                                fulfill.isPending ||
                                cancel.isPending
                              }
                              onClick={() =>
                                cancel.mutate(
                                  order.id,
                                )
                              }
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancelar
                            </Button>
                          </div>
                        )}
                    </TableCell>
                  </TableRow>
                ))}

              {!loadingOrders &&
                orders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Aún no hay pedidos
                      online.
                    </TableCell>
                  </TableRow>
                )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Nuevo pedido online
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cliente</Label>

                <Input
                  value={customerName}
                  onChange={(event) =>
                    setCustomerName(
                      event.target.value,
                    )
                  }
                  placeholder="Nombre del cliente"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Teléfono</Label>

                <Input
                  value={customerPhone}
                  onChange={(event) =>
                    setCustomerPhone(
                      event.target.value,
                    )
                  }
                  placeholder="Teléfono / WhatsApp"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                Dirección de entrega
              </Label>

              <Input
                value={address}
                onChange={(event) =>
                  setAddress(
                    event.target.value,
                  )
                }
                placeholder="Dirección"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notas</Label>

              <Input
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value,
                  )
                }
                placeholder="Notas del pedido"
              />
            </div>

            <div className="rounded-lg border p-3">
              <div className="mb-3 font-medium">
                Agregar productos
              </div>

              <div className="flex gap-2">
                <Select
                  value={pickProduct}
                  onValueChange={
                    setPickProduct
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue
                      placeholder={
                        loadingProducts ||
                        loadingInventory
                          ? "Cargando..."
                          : "Seleccionar producto"
                      }
                    />
                  </SelectTrigger>

                  <SelectContent>
                    {selectableProducts.map(
                      (product) => {
                        const stock =
                          stockByProduct.get(
                            product.id,
                          ) ?? 0;

                        return (
                          <SelectItem
                            key={
                              product.id
                            }
                            value={
                              product.id
                            }
                          >
                            {product.name} —{" "}
                            {money(
                              product.price,
                            )}{" "}
                            · Stock: {stock}
                          </SelectItem>
                        );
                      },
                    )}

                    {selectableProducts.length ===
                      0 && (
                      <SelectItem
                        value="__none__"
                        disabled
                      >
                        No hay productos con
                        existencia
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>

                <Input
                  className="w-20"
                  type="number"
                  min="1"
                  value={pickQty}
                  onChange={(event) =>
                    setPickQty(
                      event.target.value,
                    )
                  }
                />

                <Button
                  type="button"
                  variant="outline"
                  onClick={addLine}
                  disabled={
                    !pickProduct ||
                    pickProduct ===
                      "__none__"
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-lg border">
              {lines.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Agrega productos al
                  pedido.
                </div>
              ) : (
                <div className="divide-y">
                  {lines.map((line) => (
                    <div
                      key={
                        line.product_id
                      }
                      className="flex items-center gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {line.name}
                        </div>

                        <div className="text-xs text-muted-foreground">
                          {money(
                            line.unit_price,
                          )}{" "}
                          c/u · disponible{" "}
                          {
                            line.available_stock
                          }
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={() =>
                            decreaseLine(
                              line.product_id,
                            )
                          }
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
                          onClick={() =>
                            increaseLine(
                              line.product_id,
                            )
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="w-24 text-right font-medium">
                        {money(
                          line.unit_price *
                            line.quantity,
                        )}
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          removeLine(
                            line.product_id,
                          )
                        }
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
                <span className="font-medium">
                  Total del pedido
                </span>

                <span className="text-xl font-bold">
                  {money(orderTotal)}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={
                closeCreateDialog
              }
              disabled={
                createOrder.isPending
              }
            >
              Cancelar
            </Button>

            <Button
              disabled={
                createOrder.isPending ||
                !lines.length
              }
              onClick={() =>
                createOrder.mutate()
              }
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