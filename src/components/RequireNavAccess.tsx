import {
  useEffect,
  type ReactNode,
} from "react";

import {
  useNavigate,
} from "@tanstack/react-router";

import {
  ShieldAlert,
  Loader2,
} from "lucide-react";

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
    key: "caja",
    path: "/caja",
  },
  {
    key: "clientes",
    path: "/clientes",
  },
  {
    key: "inventario",
    path: "/inventario",
  },
  {
    key: "reposicion",
    path: "/reposicion",
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
    user,
    profile,
    roles,
    loading,
  } = useAuth();

  const navigate =
    useNavigate();

  /**
   * Mientras AuthProvider termina de recuperar
   * sesión, perfil y roles no mostramos una
   * pantalla de "sin acceso".
   */
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando permisos...
        </div>
      </div>
    );
  }

  /**
   * Sin sesión.
   */
  if (!user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />

        <h2 className="text-lg font-semibold">
          Sesión requerida
        </h2>

        <p className="max-w-sm text-sm text-muted-foreground">
          Tu sesión ya no está disponible.
          Regresa al inicio de sesión.
        </p>

        <button
          type="button"
          onClick={() =>
            navigate({
              to: "/auth",
            })
          }
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Ir al inicio de sesión
        </button>
      </div>
    );
  }

  /**
   * Perfil todavía no disponible.
   */
  if (!profile) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />

        <h2 className="text-lg font-semibold">
          Cuenta pendiente de configuración
        </h2>

        <p className="max-w-sm text-sm text-muted-foreground">
          Tu cuenta existe, pero todavía no tiene
          un perfil operativo configurado.
        </p>
      </div>
    );
  }

  /**
   * Perfil desactivado.
   */
  if (profile.is_active !== true) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-destructive" />

        <h2 className="text-lg font-semibold">
          Cuenta pendiente de activación
        </h2>

        <p className="max-w-sm text-sm text-muted-foreground">
          Tu cuenta está registrada pero actualmente
          se encuentra desactivada.
        </p>
      </div>
    );
  }

  /**
   * Acceso permitido.
   */
  if (
    roles.length > 0 &&
    canAccess(
      roles,
      navKey,
    )
  ) {
    return <>{children}</>;
  }

  const fallback =
    FALLBACK_ROUTES.find(
      (route) =>
        canAccess(
          roles,
          route.key,
        ),
    ) ?? null;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-7 w-7 text-destructive" />
      </div>

      <h2 className="text-lg font-semibold">
        No tienes acceso a esta sección
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        Tu usuario está activo, pero no tiene
        el permiso necesario para esta sección.
      </p>

      {fallback ? (
        <button
          type="button"
          onClick={() =>
            navigate({
              to: fallback.path,
            })
          }
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Ir a una sección disponible
        </button>
      ) : (
        <div className="mt-2 max-w-md rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">
            Sin permisos asignados
          </p>

          <p className="mt-1">
            Tu cuenta está activa, pero no se
            detectó ningún rol.
          </p>

          <p className="mt-2 text-xs opacity-80">
            Roles detectados:{" "}
            {roles.length > 0
              ? roles.join(", ")
              : "ninguno"}
          </p>
        </div>
      )}
    </div>
  );
}