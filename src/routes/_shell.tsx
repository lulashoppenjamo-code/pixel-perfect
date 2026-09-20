import { useEffect } from "react";
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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BranchProvider, useBranch } from "@/lib/branch";
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

const nav = [
  { to: "/ventas", label: "Ventas", icon: ShoppingCart },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/inventario", label: "Inventario", icon: Boxes },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/compras", label: "Compras", icon: Truck },
  { to: "/caja", label: "Caja", icon: Wallet },
  { to: "/reportes", label: "Reportes", icon: BarChart3 },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

function ShellLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Cargando…</div>;
  }

  return (
    <BranchProvider>
      <div className="flex min-h-screen flex-col bg-muted/30 md:flex-row">
        <aside className="flex shrink-0 flex-col gap-1 border-b bg-card p-3 md:w-56 md:border-b-0 md:border-r">
          <div className="mb-2 hidden px-2 text-lg font-semibold tracking-tight md:block">Lula Shop OS</div>
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
    <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Select value={branchId ?? undefined} onValueChange={setBranchId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Sin sucursales" />
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
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {profile?.full_name ?? "Usuario"} · {roles.join(", ") || "sin rol"}
        </span>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          <LogOut className="size-4" /> Salir
        </Button>
      </div>
    </header>
  );
}
