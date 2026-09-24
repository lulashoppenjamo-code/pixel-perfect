import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PhysicalCountProgressProps = {
  startedAt: string;
  total: number;
  counted: number;
  pending: number;
  completed?: boolean;
};

const MAX_DAYS = 3;
const MAX_MS = MAX_DAYS * 24 * 60 * 60 * 1000;

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1000),
  );

  const days = Math.floor(
    totalSeconds / 86400,
  );

  const hours = Math.floor(
    (totalSeconds % 86400) / 3600,
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );

  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

export function PhysicalCountProgress({
  startedAt,
  total,
  counted,
  pending,
  completed = false,
}: PhysicalCountProgressProps) {
  const [now, setNow] = useState(
    () => Date.now(),
  );

  useEffect(() => {
    if (completed) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [completed]);

  const progress = useMemo(() => {
    if (total <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(
        0,
        (counted / total) * 100,
      ),
    );
  }, [counted, total]);

  const startedTimestamp = useMemo(
    () => new Date(startedAt).getTime(),
    [startedAt],
  );

  const deadline = useMemo(
    () => startedTimestamp + MAX_MS,
    [startedTimestamp],
  );

  const elapsed = Math.max(
    0,
    now - startedTimestamp,
  );

  const remaining = Math.max(
    0,
    deadline - now,
  );

  const expired =
    !completed &&
    elapsed >= MAX_MS;

  const warning =
    !expired &&
    !completed &&
    remaining <=
      24 * 60 * 60 * 1000;

  const statusText = completed
    ? "Inventario completado"
    : expired
      ? "Límite de 3 días excedido"
      : warning
        ? "Queda menos de 1 día"
        : "Dentro del plazo";

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Clock3 className="h-4 w-4" />
            Control del inventario físico
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            El conteo debe completarse dentro de
            un máximo de 3 días desde su inicio.
          </p>
        </div>

        <Badge
          variant={
            expired
              ? "destructive"
              : warning
                ? "outline"
                : completed
                  ? "secondary"
                  : "default"
          }
          className={cn(
            "w-fit gap-1",
            warning &&
              !expired &&
              !completed &&
              "border-amber-500 text-amber-600",
          )}
        >
          {completed ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : expired || warning ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Clock3 className="h-3.5 w-3.5" />
          )}

          {statusText}
        </Badge>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Avance
          </span>

          <span className="font-semibold">
            {counted} / {total} productos
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              expired
                ? "bg-destructive"
                : "bg-primary",
            )}
            style={{
              width: `${progress}%`,
            }}
          />
        </div>

        <p className="mt-1 text-right text-xs text-muted-foreground">
          {progress.toFixed(0)}% completado
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Contados
          </p>

          <p className="text-lg font-bold">
            {counted}
          </p>
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Pendientes
          </p>

          <p
            className={cn(
              "text-lg font-bold",
              pending > 0 &&
                "text-destructive",
            )}
          >
            {pending}
          </p>
        </div>

        <div
          className={cn(
            "rounded-md border p-3",
            expired &&
              "border-destructive/30 bg-destructive/5",
            warning &&
              !expired &&
              "border-amber-500/30 bg-amber-500/5",
          )}
        >
          <p className="text-xs text-muted-foreground">
            Tiempo restante
          </p>

          <p
            className={cn(
              "text-lg font-bold",
              expired &&
                "text-destructive",
              warning &&
                !expired &&
                "text-amber-600",
            )}
          >
            {completed
              ? "Completado"
              : expired
                ? "0"
                : formatRemaining(
                    remaining,
                  )}
          </p>
        </div>
      </div>

      {expired && !completed && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />

          <div>
            <p className="font-medium">
              El inventario lleva más de 3 días abierto.
            </p>

            <p className="mt-1 text-xs">
              Termina el conteo cuanto antes. El
              cierre seguirá requiriendo que todos
              los productos tengan cantidad física.
            </p>
          </div>
        </div>
      )}

      {warning && !expired && !completed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />

          <div>
            <p className="font-medium">
              El plazo está por terminar.
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Faltan {pending} productos por contar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PhysicalCountProgress;