import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  PackageX,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  getSharedInventory,
  type SharedInventoryRow,
} from "@/lib/sharedInventory";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type InventoryAlertsProps = {
  compact?: boolean;
  onOpenInventory?: () => void;
};

export function InventoryAlerts({
  compact = false,
  onOpenInventory,
}: InventoryAlertsProps) {
  const [open, setOpen] = useState(false);

  const {
    data: inventory = [],
    isLoading,
  } = useQuery({
    queryKey: ["shared-inventory"],
    queryFn: getSharedInventory,
    staleTime: 30_000,
  });

  const alerts = useMemo(() => {
    return inventory
      .filter(
        (row: SharedInventoryRow) =>
          row.stock_status === "out_of_stock" ||
          row.stock_status === "low_stock",
      )
      .sort((a, b) => {
        if (
          a.stock_status === "out_of_stock" &&
          b.stock_status !== "out_of_stock"
        ) {
          return -1;
        }

        if (
          a.stock_status !== "out_of_stock" &&
          b.stock_status === "out_of_stock"
        ) {
          return 1;
        }

        return (
          Number(a.available_stock) -
          Number(b.available_stock)
        );
      });
  }, [inventory]);

  const outOfStock = alerts.filter(
    (row) =>
      row.stock_status === "out_of_stock",
  );

  const lowStock = alerts.filter(
    (row) =>
      row.stock_status === "low_stock",
  );

  const totalAlerts = alerts.length;

  if (isLoading) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="relative"
      >
        <Bell className="h-5 w-5" />
      </Button>
    );
  }

  if (compact) {
    return (
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setOpen((value) => !value)
          }
          className="relative"
          aria-label="Alertas de inventario"
        >
          <Bell className="h-5 w-5" />

          {totalAlerts > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {totalAlerts > 99
                ? "99+"
                : totalAlerts}
            </span>
          )}
        </Button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-24px))] rounded-xl border bg-card p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  Alertas de inventario
                </p>

                <p className="text-xs text-muted-foreground">
                  Inventario compartido
                </p>
              </div>

              <Badge
                variant={
                  totalAlerts > 0
                    ? "destructive"
                    : "secondary"
                }
              >
                {totalAlerts}
              </Badge>
            </div>

            {totalAlerts === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <Bell className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />

                <p className="text-sm font-medium">
                  Sin alertas
                </p>

                <p className="mt-1 text-xs text-muted-foreground">
                  No hay productos agotados o
                  bajo mínimo.
                </p>
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {alerts.map((row) => {
                  const isOut =
                    row.stock_status ===
                    "out_of_stock";

                  return (
                    <div
                      key={`${row.product_id}-${row.variant_id ?? "base"}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex items-start gap-2">
                        {isOut ? (
                          <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {row.emoji ?? "📦"}{" "}
                            {row.product_name}
                          </p>

                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>
                              Disponible:{" "}
                              <strong>
                                {
                                  row.available_stock
                                }
                              </strong>
                            </span>

                            <span>
                              Mínimo:{" "}
                              <strong>
                                {row.min_stock}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <Badge
                          variant={
                            isOut
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {isOut
                            ? "Agotado"
                            : "Bajo"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {onOpenInventory &&
              totalAlerts > 0 && (
                <Button
                  type="button"
                  className="mt-3 w-full"
                  onClick={() => {
                    setOpen(false);
                    onOpenInventory();
                  }}
                >
                  Ver inventario
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      className={
        totalAlerts > 0
          ? "border-destructive/30"
          : undefined
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-5 w-5" />
              Alertas de inventario
            </CardTitle>

            <p className="mt-1 text-xs text-muted-foreground">
              Productos que requieren atención.
            </p>
          </div>

          <Badge
            variant={
              totalAlerts > 0
                ? "destructive"
                : "secondary"
            }
          >
            {totalAlerts}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {totalAlerts === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-center">
            <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />

            <p className="text-sm font-medium">
              Inventario en orden
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              No hay productos agotados o bajo el
              mínimo configurado.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Agotados
                </p>

                <p className="text-xl font-bold text-destructive">
                  {outOfStock.length}
                </p>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Bajo mínimo
                </p>

                <p className="text-xl font-bold">
                  {lowStock.length}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {alerts
                .slice(0, 8)
                .map((row) => {
                  const isOut =
                    row.stock_status ===
                    "out_of_stock";

                  return (
                    <div
                      key={`${row.product_id}-${row.variant_id ?? "base"}`}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      {isOut ? (
                        <PackageX className="h-5 w-5 shrink-0 text-destructive" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.emoji ?? "📦"}{" "}
                          {row.product_name}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          Disponible{" "}
                          {row.available_stock}
                          {" · "}
                          mínimo{" "}
                          {row.min_stock}
                        </p>
                      </div>

                      <Badge
                        variant={
                          isOut
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {isOut
                          ? "Agotado"
                          : "Bajo"}
                      </Badge>
                    </div>
                  );
                })}
            </div>

            {alerts.length > 8 && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                +{alerts.length - 8} alertas más
              </p>
            )}

            {onOpenInventory && (
              <Button
                type="button"
                variant="outline"
                className="mt-4 w-full"
                onClick={onOpenInventory}
              >
                Abrir inventario
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default InventoryAlerts;