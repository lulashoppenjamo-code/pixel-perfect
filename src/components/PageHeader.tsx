/**
 * Cabecera de página unificada — estilo Zobaze POS
 * Título grande, subtítulo suave, acción opcional a la derecha.
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
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f0fe] text-[#1a73e8]">
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#212121] sm:text-xl">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-[#757575]">{description}</p>
          )}
        </div>
      </div>
      {action && (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  );
}

/** Contenedor de página con padding y espaciado unificados */
export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 p-3 md:space-y-5 md:p-5", className)}>
      {children}
    </div>
  );
} 