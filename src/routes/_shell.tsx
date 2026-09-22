/**
 * Shell layout — LULA OS
 * Ruta: src/routes/_shell.tsx
 */
import { useEffect, useMemo } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ShoppingCart,
  Package,
  Boxes,
  Users,
  Truck,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  RotateCcw,
  Store,
  Bot,
  Receipt,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BranchProvider, useBranch } from "@/lib/branch";
import { canAccess, type NavKey } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

const ALL_NAV: { key: NavKey; to: string; label: string; icon: typeof ShoppingCart }[] = [
  { key: "ventas", to: "/ventas", label: "Ventas", icon: ShoppingCart },
  { key: "productos", to: "/productos", label: "Productos", icon: Package },
  { key: "inventario", to: "/inventario", label: "Inventario", icon: Boxes },
  { key: "clientes", to: "/clientes", label: "Clientes", icon: Users },
  { key: "compras", to: "/compras", label: "Compras", icon: Truck },
  { key: "caja", to: "/caja", label: "Caja", icon: Wallet },
  { key: "gastos", to: "/gastos", label: "Gastos", icon: Receipt },
  { key: "devoluciones", to: "/devoluciones", label: "Devoluciones", icon: RotateCcw },
  { key: "pedidos", to: "/pedidos", label: "Pedidos online", icon: Store },
  { key: "reportes", to: "/reportes", label: "Reportes", icon: BarChart3 },
  { key: "ceo", to: "/ceo", label: "CEO IA", icon: Bot },
  { key: "ajustes", to: "/ajustes", label: "Ajustes", icon: Settings },
];

function ShellLayout() {
  const { user, loading, roles, signOut, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const nav = useMemo(
    () => ALL_NAV.filter((item) => canAccess(roles, item.key)),
    [roles],
  );

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Cargando…
      </div>
    );
  }

  return (
    <BranchProvider>
      <ShellInner
        nav={nav}
        profileName={profile?.full_name ?? user.email ?? "Usuario"}
        onSignOut={async () => {
          await signOut();
          void navigate({ to: "/auth" });
        }}
      />
    </BranchProvider>
  );
}

function ShellInner({
  nav,
  profileName,
  onSignOut,
}: {
  nav: typeof ALL_NAV;
  profileName: string;
  onSignOut: () => void;
}) {
  const { branches, branchId, setBranchId } = useBranch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen flex-col bg-muted/30 md:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 border-b bg-card p-3 md:w-56 md:border-b-0 md:border-r">
        <div className="mb-1 hidden px-2 md:block">
          <div className="text-lg font-bold tracking-tight text-primary">LULA OS</div>
          <div className="text-[11px] text-muted-foreground">Sistema empresarial</div>
        </div>

        {branches.length > 1 && (
          <div className="mb-2 px-1">
            <Select value={branchId ?? undefined} onValueChange={setBranchId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden border-t pt-3 md:block">
          <p className="truncate px-2 text-xs text-muted-foreground">{profileName}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-2 text-muted-foreground"
            onClick={onSignOut}
          >
            <LogOut className="h-4 w-4" />
            Salir
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
