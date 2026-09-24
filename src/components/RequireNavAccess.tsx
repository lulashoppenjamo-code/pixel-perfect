/**
 * RequireNavAccess — LULA OS
 * Ruta: src/components/RequireNavAccess.tsx
 *
 * F2 (protección real de rutas): antes, filterNavByRoles() en
 * _shell.tsx solo ocultaba el enlace del menú. Un usuario podía
 * teclear la URL directamente (ej. /ajustes o /ceo) y la página
 * cargaba igual, sin importar su rol.
 *
 * Este componente envuelve el `component` de cada ruta protegida.
 * Si el rol no tiene acceso, el componente de la página real NUNCA
 * se monta (ni siquiera se ejecutan sus hooks/fetches) — se muestra
 * un aviso y un botón para volver a una sección permitida.
 *
 * No inventa reglas nuevas de permisos: reutiliza tal cual
 * `canAccess()` / `NavKey` de src/lib/permissions.ts.
 *
 * Nota de arquitectura: esta app carga los roles del usuario dentro
 * de React (AuthProvider), no en el contexto del router. Por eso el
 * guard vive como componente (se evalúa al montar la página) y no
 * como `beforeLoad` del router, que en TanStack Start puede correr
 * antes de que exista sesión/roles disponibles. Es una protección
 * real en el cliente; igual que en el resto del sistema, la defensa
 * de fondo es RLS en Supabase.
 */
import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { canAccess, type NavKey } from "@/lib/permissions";

export function RequireNavAccess({ navKey, children }: { navKey: NavKey; children: ReactNode }) {
  const { roles, loading } = useAuth();
  const navigate = useNavigate();

  // Mientras se cargan roles (justo después de iniciar sesión), no
  // decidimos nada todavía: evita un "no autorizado" falso de un
  // instante antes de que roles[] llegue de Supabase.
  if (loading) return null;

  if (!canAccess(roles, navKey)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">No tienes acceso a esta sección</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Tu rol actual no incluye permiso para ver esta página. Si crees que
          es un error, contacta al administrador de tu tienda.
        </p>
        <button
          onClick={() => navigate({ to: "/caja" })}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Ir a Caja
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
