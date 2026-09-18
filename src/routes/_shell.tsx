/**
 * Shell layout con guards por rol — FASE 1
 * Ruta: src/routes/_shell.tsx
 * Reemplaza el archivo existente.
 */
import { useEffect, useMemo } from "react";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
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
  { key: "devoluciones", to: "/devoluciones", label: "Devoluciones", icon: RotateCcw },
  { key: "reportes", to: "/reportes", label: "Reportes", icon: BarChart3 },
  { key: "ajustes", to: "/ajustes", label: "Ajustes", icon: Settings },
];

function ShellLayout() {
  const { user, loading, roles } = useAuth();
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
      <div className="flex min-h-screen flex-col bg-muted/30 md:flex-row">
        <aside className="flex shrink-0 flex-col gap-1 border-b bg-card p-3 md:w-56 md:border-b-0 md:border-r">
          <div className="mb-2 hidden px-2 text-lg font-semibold tracking-tight md:block">
            Lula Shop OS
          </div>
          <nav className="flex gap-1 overflow-x-auto md:flex-col">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                activeProps={{ className: "bg-primary/10 text-primary font-medium" }}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-w-0 flex-1 p-4">
            <Outlet />
          </main>
        </div>
      </div>
    </BranchProvider>
  );
}

function TopBar() {
  const { profile, roles, signOut } = useAuth();
  const { branches, branchId, setBranchId } = useBranch();

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground md:hidden">Lula Shop OS</span>
        {branches.length > 0 && (
          <Select value={branchId ?? undefined} onValueChange={setBranchId}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          <
... 