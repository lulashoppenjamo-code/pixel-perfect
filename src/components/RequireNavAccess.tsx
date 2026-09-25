/**
 * RequireNavAccess — LULA OS
 * Protección real de rutas según rol.
 */

import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { useAuth } from "@/lib/auth";
import {
  canAccess,
  type NavKey,
} from "@/lib/permissions";

const FALLBACK_ROUTES: {
  key: NavKey;
  path: string;
}[] = [
  {
    key: "ventas",
    path: "/ventas",
  },
  {
    key: "clientes",
    path: "/clientes",
  },
  {
    key: "reposicion",
    path: "/reposicion",
  },
  {
    key: "caja",
    path: "/caja",
  },
  {
    key: "inventario",
    path: "/inventario",
  },
];

export function RequireNavAccess({
  navKey,
  children,
}: {
  navKey: NavKey;
  children: ReactNode;
}) {
  const {
    roles,
    loading,
  } = useAuth();

  const navigate = useNavigate();

  if (loading) {
    return null;
  }

  if (canAccess(roles, navKey)) {
    return <>{children}</>;
  }

  const fallback =
    FALLBACK_ROUTES.find((route) =>
      canAccess(roles, route.key),
    ) ?? null;

  const goToAllowedSection = () => {
    if (!fallback) {
      return;
    }

    navigate({
      to: fallback.path,
    });
  };

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-7 w-7 text-destructive" />
      </div>

      <h2 className="text-lg font-semibold">
        No tienes acceso a esta sección
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        Tu rol actual no incluye permiso
        para ver esta página.
      </p>

      {fallback ? (
        <button
          type="button"
          onClick={goToAllowedSection}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Ir a una sección disponible
        </button>
      ) : (
        <p className="mt-2 max-w-sm rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Tu usuario no tiene ninguna
          sección disponible. Contacta al
          administrador para asignar un rol.
        </p>
      )}
    </div>
  );
}