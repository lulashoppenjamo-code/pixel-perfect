/**
 * Cabecera de página unificada — Lula Shop OS
 *
 * RESPONSIVE:
 * - Diseñada primero para celular y tablet.
 * - No modifica lógica ni datos.
 * - Las acciones se adaptan al ancho disponible.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "min-w-0 w-full",
        className,
      )}
    >
      <div className="flex min-w-0 w-full flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
        {/* Título */}
        <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
          {Icon && (
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f0fe] text-[#1a73e8] sm:h-10 sm:w-10">
              <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="break-words text-base font-bold leading-tight tracking-tight text-[#212121] sm:text-lg md:text-xl">
              {title}
            </h1>

            {description && (
              <p className="mt-1 break-words text-xs leading-5 text-[#757575] sm:text-sm">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Acción */}
        {action && (
          <div className="flex min-w-0 w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end">
            {action}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Contenedor estándar de página.
 *
 * Mobile:
 *   padding compacto para aprovechar toda la pantalla.
 *
 * Tablet:
 *   más espacio lateral y vertical.
 *
 * Desktop:
 *   se conserva como compatibilidad, aunque el producto
 *   está orientado principalmente a celular y tablet.
 */
export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "box-border min-w-0 w-full max-w-full space-y-4 overflow-x-hidden p-3 pb-4",
        "sm:space-y-4 sm:p-4",
        "md:space-y-5 md:p-5",
        "lg:space-y-5 lg:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}