import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import type { SharedInventoryRow } from "@/lib/sharedInventory";

type RestockItem = {
  id: string;
  product: string;
  quantity: number;
  notes: string;
  completed: boolean;
};

type RestockListProps = {
  inventory?: SharedInventoryRow[];
};

const STORAGE_KEY = "lula-os-restock-list";

function loadItems(): RestockItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw =
      window.localStorage.getItem(
        STORAGE_KEY,
      );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as RestockItem[];
  } catch {
    return [];
  }
}

function saveItems(items: RestockItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items),
    );
  } catch {
    // Si localStorage no está disponible,
    // la lista continúa funcionando durante
    // la sesión actual.
  }
}

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getSuggestedQuantity(
  row: SharedInventoryRow,
) {
  const available = Number(
    row.available_stock ?? 0,
  );

  const minimum = Number(
    row.min_stock ?? 0,
  );

  const maximum =
    row.max_stock === null ||
    row.max_stock === undefined
      ? null
      : Number(row.max_stock);

  if (maximum !== null && maximum > available) {
    return Math.max(
      0,
      Math.ceil(maximum - available),
    );
  }

  if (available <= minimum) {
    return Math.max(
      1,
      Math.ceil(
        minimum > 0
          ? minimum - available
          : 1,
      ),
    );
  }

  return 0;
}

export function RestockList({
  inventory = [],
}: RestockListProps) {
  const [items, setItems] =
    useState<RestockItem[]>(loadItems);

  const [product, setProduct] =
    useState("");

  const [quantity, setQuantity] =
    useState("1");

  const [notes, setNotes] =
    useState("");

  const pendingItems = useMemo(
    () =>
      items.filter(
        (item) => !item.completed,
      ),
    [items],
  );

  const completedItems = useMemo(
    () =>
      items.filter(
        (item) => item.completed,
      ),
    [items],
  );

  const inventorySuggestions = useMemo(() => {
    const seen = new Set<string>();

    return inventory
      .map((row) => {
        const available = Number(
          row.available_stock ?? 0,
        );

        const minimum = Number(
          row.min_stock ?? 0,
        );

        const suggested =
          getSuggestedQuantity(row);

        return {
          row,
          available,
          minimum,
          suggested,
        };
      })
      .filter((item) => {
        if (item.suggested <= 0) {
          return false;
        }

        const key = item.row.variant_id
          ? `${item.row.product_id}:${item.row.variant_id}`
          : item.row.product_id;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      });
  }, [inventory]);

  const outOfStockCount = useMemo(
    () =>
      inventorySuggestions.filter(
        (item) =>
          item.available <= 0,
      ).length,
    [inventorySuggestions],
  );

  const lowStockCount = useMemo(
    () =>
      inventorySuggestions.filter(
        (item) =>
          item.available > 0 &&
          item.available <= item.minimum,
      ).length,
    [inventorySuggestions],
  );

  const totalSuggestedUnits = useMemo(
    () =>
      inventorySuggestions.reduce(
        (sum, item) =>
          sum + item.suggested,
        0,
      ),
    [inventorySuggestions],
  );

  const addItem = () => {
    const name = product.trim();
    const qty = Number(quantity);

    if (!name) {
      return;
    }

    if (
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      return;
    }

    const newItem: RestockItem = {
      id: createId(),
      product: name,
      quantity: Math.ceil(qty),
      notes: notes.trim(),
      completed: false,
    };

    const next = [
      newItem,
      ...items,
    ];

    setItems(next);
    saveItems(next);

    setProduct("");
    setQuantity("1");
    setNotes("");
  };

  const addInventorySuggestion = (
    row: SharedInventoryRow,
    suggestedQuantity: number,
  ) => {
    const productName =
      row.product_name;

    const variantLabel =
      row.variant_id
        ? "Variante"
        : "";

    const noteParts = [
      "Sugerido por inventario",
      row.sku
        ? `SKU ${row.sku}`
        : "",
      variantLabel,
    ].filter(Boolean);

    const existingIndex =
      items.findIndex(
        (item) =>
          !item.completed &&
          item.product
            .trim()
            .toLowerCase() ===
            productName
              .trim()
              .toLowerCase(),
      );

    let next: RestockItem[];

    if (existingIndex >= 0) {
      next = items.map(
        (item, index) =>
          index === existingIndex
            ? {
                ...item,
                quantity:
                  item.quantity +
                  suggestedQuantity,
                notes:
                  item.notes ||
                  noteParts.join(
                    " · ",
                  ),
              }
            : item,
      );
    } else {
      const newItem: RestockItem = {
        id: createId(),
        product: productName,
        quantity:
          Math.ceil(
            suggestedQuantity,
          ),
        notes:
          noteParts.join(" · "),
        completed: false,
      };

      next = [
        newItem,
        ...items,
      ];
    }

    setItems(next);
    saveItems(next);
  };

  const addAllSuggestions = () => {
    if (
      inventorySuggestions.length ===
      0
    ) {
      return;
    }

    let next = [...items];

    for (const suggestion of inventorySuggestions) {
      const productName =
        suggestion.row.product_name;

      const existingIndex =
        next.findIndex(
          (item) =>
            !item.completed &&
            item.product
              .trim()
              .toLowerCase() ===
              productName
                .trim()
                .toLowerCase(),
        );

      const notes = [
        "Sugerido por inventario",
        suggestion.row.sku
          ? `SKU ${suggestion.row.sku}`
          : "",
        suggestion.row.variant_id
          ? "Variante"
          : "",
      ].filter(Boolean).join(" · ");

      if (existingIndex >= 0) {
        next = next.map(
          (item, index) =>
            index === existingIndex
              ? {
                  ...item,
                  quantity:
                    item.quantity +
                    suggestion.suggested,
                  notes:
                    item.notes ||
                    notes,
                }
              : item,
        );
      } else {
        next.unshift({
          id: createId(),
          product: productName,
          quantity:
            Math.ceil(
              suggestion.suggested,
            ),
          notes,
          completed: false,
        });
      }
    }

    setItems(next);
    saveItems(next);
  };

  const toggleCompleted = (
    id: string,
  ) => {
    const next = items.map((item) =>
      item.id === id
        ? {
            ...item,
            completed:
              !item.completed,
          }
        : item,
    );

    setItems(next);
    saveItems(next);
  };

  const deleteItem = (
    id: string,
  ) => {
    const next = items.filter(
      (item) => item.id !== id,
    );

    setItems(next);
    saveItems(next);
  };

  const clearCompleted = () => {
    const next = items.filter(
      (item) => !item.completed,
    );

    setItems(next);
    saveItems(next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-5 w-5" />
                Lista de reposición semanal
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Reúne aquí todo lo que necesitas
                pedir. Esta lista no modifica el
                inventario.
              </p>
            </div>

            <Badge variant="outline">
              {pendingItems.length} pendientes
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_120px]">
              <div className="space-y-1.5">
                <Label>
                  Producto
                </Label>

                <Input
                  value={product}
                  onChange={(event) =>
                    setProduct(
                      event.target.value,
                    )
                  }
                  placeholder="Ej. Pegamento para pestañas"
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      addItem();
                    }
                  }}
                />
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
                  onChange={(event) =>
                    setQuantity(
                      event.target.value,
                    )
                  }
                />
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <Label>
                Nota
              </Label>

              <Input
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value,
                  )
                }
                placeholder="Color, presentación, proveedor, etc."
              />
            </div>

            <Button
              className="mt-3 w-full sm:w-auto"
              onClick={addItem}
              disabled={
                !product.trim()
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Agregar a reposición
            </Button>
          </div>

          {inventorySuggestions.length >
            0 && (
            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PackagePlus className="h-5 w-5" />
                      Sugerencias del inventario
                    </CardTitle>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Productos agotados o por debajo
                      del mínimo configurado.
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      addAllSuggestions
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Agregar todos
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {outOfStockCount >
                    0 && (
                    <Badge variant="destructive">
                      {outOfStockCount} agotados
                    </Badge>
                  )}

                  {lowStockCount >
                    0 && (
                    <Badge variant="outline">
                      {lowStockCount} bajo mínimo
                    </Badge>
                  )}

                  <Badge variant="secondary">
                    {totalSuggestedUnits} uds sugeridas
                  </Badge>
                </div>
              </CardHeader>

              <CardContent>
                <div className="space-y-2">
                  {inventorySuggestions.map(
                    ({
                      row,
                      available,
                      minimum,
                      suggested,
                    }) => {
                      const isOut =
                        available <= 0;

                      return (
                        <div
                          key={`${row.product_id}-${row.variant_id ?? "base"}`}
                          className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">
                                {row.emoji ??
                                  "📦"}{" "}
                                {
                                  row.product_name
                                }
                              </p>

                              {row.variant_id && (
                                <Badge variant="outline">
                                  Variante
                                </Badge>
                              )}

                              {isOut ? (
                                <Badge variant="destructive">
                                  Agotado
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  Bajo mínimo
                                </Badge>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                Disponible:{" "}
                                {available}
                              </span>

                              <span>
                                Mínimo:{" "}
                                {minimum}
                              </span>

                              {row.max_stock !==
                                null && (
                                <span>
                                  Máximo:{" "}
                                  {
                                    row.max_stock
                                  }
                                </span>
                              )}

                              {row.sku && (
                                <span className="font-mono">
                                  SKU:{" "}
                                  {row.sku}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">
                                Sugerencia
                              </p>

                              <p className="font-bold">
                                +{suggested} uds
                              </p>
                            </div>

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                addInventorySuggestion(
                                  row,
                                  suggested,
                                )
                              }
                            >
                              <Plus className="mr-1 h-4 w-4" />
                              Agregar
                            </Button>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-medium">
                  Pendientes
                </p>

                <p className="text-xs text-muted-foreground">
                  Productos que todavía necesitas pedir.
                </p>
              </div>
            </div>

            {pendingItems.length ===
            0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />

                <p className="text-sm font-medium">
                  No hay productos pendientes
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  Agrega productos manualmente o utiliza
                  las sugerencias del inventario.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingItems.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {item.product}
                        </p>

                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>
                            Cantidad:{" "}
                            {item.quantity}
                          </span>

                          {item.notes && (
                            <span>
                              •{" "}
                              {item.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            toggleCompleted(
                              item.id,
                            )
                          }
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Pedido
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            deleteItem(
                              item.id,
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {completedItems.length >
            0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    Pedidos realizados
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Elementos marcados como pedidos.
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={
                    clearCompleted
                  }
                >
                  Limpiar
                </Button>
              </div>

              <div className="space-y-2">
                {completedItems.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border bg-muted/20 p-3"
                    >
                      <div>
                        <p className="font-medium line-through opacity-60">
                          {item.product}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          Cantidad:{" "}
                          {item.quantity}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleCompleted(
                            item.id,
                          )
                        }
                      >
                        Deshacer
                      </Button>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {inventory.length ===
            0 && (
            <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />

              <p>
                No se recibieron datos del inventario
                compartido. La lista manual continúa
                disponible.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default RestockList;