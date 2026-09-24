import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert, LogOut, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { canAccess, type NavKey } from "@/lib/permissions";

export function RequireNavAccess({
  navKey,
  children,
}: {
  navKey: NavKey;
  children: ReactNode;
}) {
  const { roles, loading, user, profile, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Verificando permisos…
        </p>
      </div>
    );
  }

  if (canAccess(roles, navKey)) {
    return <>{children}</>;
  }

  const handleRefresh = async () => {
    await refresh();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-7 w-7 text-destructive" />
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          No tienes acceso a esta sección
        </h2>

        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Tu sesión está activa, pero Lula OS no está recibiendo un rol válido
          para esta sección.
        </p>

        {user?.email && (
          <p className="pt-1 text-xs text-muted-foreground">
            Usuario: {user.email}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Rol detectado: {roles.length ? roles.join(", ") : "ninguno"}
          {profile && !profile.is_active ? " · usuario inactivo" : ""}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar permisos
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}