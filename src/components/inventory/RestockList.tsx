import { useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
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

type RestockItem = {
  id: string;
  product: string;
  quantity: number;
  notes: string;
  completed: boolean;
};

const STORAGE_KEY =
  "lula-os-restock-list";

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

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(items),
  );
}

export function RestockList() {
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
      id: crypto.randomUUID(),
      product: name,
      quantity: qty,
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
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5" />
              Lista de reposición
            </CardTitle>

            <p className="mt-1 text-xs text-muted-foreground">
              Lista independiente para reunir
              productos que necesitas pedir durante
              la semana.
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
                    event.key === "Enter"
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
            disabled={!product.trim()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Agregar a reposición
          </Button>
        </div>

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

          {pendingItems.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />

              <p className="text-sm font-medium">
                No hay productos pendientes
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Agrega aquí cualquier producto que
                necesites reponer durante la semana.
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
                            • {item.notes}
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

        {completedItems.length > 0 && (
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
      </CardContent>
    </Card>
  );
}

export default RestockList;