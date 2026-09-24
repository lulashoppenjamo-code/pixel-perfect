import { useState } from "react";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";

import { Button } from "@/components/ui/button";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  filterNavByRoles,
  type NavKey,
} from "@/lib/permissions";

import {
  ShoppingBag,
  Receipt,
  Package,
  Boxes,
  Users,
  Truck,
  Wallet,
  Undo2,
  ClipboardList,
  TrendingUp,
  Settings,
  LogOut,
  AlertTriangle,
  RotateCcw,
  MoreHorizontal,
  ShoppingCart,
} from "lucide-react";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
  errorComponent: ShellErrorComponent,
});

function ShellErrorComponent({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-8 w-8" />
      </div>

      <h2 className="mb-2 text-2xl font-bold">
        Error al cargar la sección
      </h2>

      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        {error?.message ||
          "Ocurrió un problema al inicializar el módulo o la sesión de usuario."}
      </p>

      <div className="flex gap-3">
        <Button onClick={() => reset()}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>

        <Button
          onClick={() => {
            window.location.href = "/auth";
          }}
          variant="outline"
        >
          Ir al Login
        </Button>
      </div>
    </div>
  );
}

function ShellLayout() {
  const { user, roles, signOut } = useAuth();

  const {
    branchId,
    setBranchId,
    branches,
  } = useBranch();

  const navigate = useNavigate();
  const location = useLocation();

  const allNavItems: {
    label: string;
    path: string;
    icon: typeof ShoppingBag;
    key: NavKey;
  }[] = [
    {
      label: "Caja (POS)",
      path: "/caja",
      icon: ShoppingBag,
      key: "caja",
    },
    {
      label: "Historial de ventas",
      path: "/ventas",
      icon: Receipt,
      key: "ventas",
    },
    {
      label: "Productos",
      path: "/productos",
      icon: Package,
      key: "productos",
    },
    {
      label: "Inventario",
      path: "/inventario",
      icon: Boxes,
      key: "inventario",
    },
    {
      label: "Reposición",
      path: "/reposicion",
      icon: ShoppingCart,
      key: "reposicion",
    },
    {
      label: "Compras",
      path: "/compras",
      icon: Truck,
      key: "compras",
    },
    {
      label: "Clientes",
      path: "/clientes",
      icon: Users,
      key: "clientes",
    },
    {
      label: "Devoluciones",
      path: "/devoluciones",
      icon: Undo2,
      key: "devoluciones",
    },
    {
      label: "Gastos",
      path: "/gastos",
      icon: Wallet,
      key: "gastos",
    },
    {
      label: "Pedidos",
      path: "/pedidos",
      icon: ClipboardList,
      key: "pedidos",
    },
    {
      label: "Reportes",
      path: "/reportes",
      icon: TrendingUp,
      key: "reportes",
    },
    {
      label: "CEO",
      path: "/ceo",
      icon: TrendingUp,
      key: "ceo",
    },
    {
      label: "Ajustes",
      path: "/ajustes",
      icon: Settings,
      key: "ajustes",
    },
  ];

  const navItems = filterNavByRoles(
    allNavItems,
    roles,
  );

  const [moreOpen, setMoreOpen] = useState(false);

  const primaryKeys: NavKey[] = [
    "caja",
    "ventas",
    "inventario",
    "clientes",
  ];

  const primaryItems = navItems.filter(
    (item) =>
      primaryKeys.includes(item.key),
  );

  const moreItems = navItems.filter(
    (item) =>
      !primaryKeys.includes(item.key),
  );

  const goTo = (path: string) => {
    setMoreOpen(false);
    navigate({ to: path });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 select-none flex-col justify-between border-r bg-card p-4 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground shadow-sm">
              L
            </div>

            <div>
              <h1 className="text-lg font-bold leading-tight">
                Lula OS
              </h1>

              <p className="text-xs text-muted-foreground">
                Punto de Venta
              </p>
            </div>
          </div>

          <div className="px-2">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Sucursal Activa
            </label>

            <select
              value={branchId ?? ""}
              onChange={(event) =>
                setBranchId(event.target.value)
              }
              className="w-full cursor-pointer rounded-lg border bg-background p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-primary"
            >
              {branches &&
              branches.length > 0 ? (
                branches.map((branch) => (
                  <option
                    key={branch.id}
                    value={branch.id}
                  >
                    {branch.name}
                  </option>
                ))
              ) : (
                <option value="">
                  Cargando sucursales...
                </option>
              )}
            </select>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              const isActive =
                location.pathname.startsWith(
                  item.path,
                );

              return (
                <button
                  key={item.path}
                  onClick={() =>
                    navigate({
                      to: item.path,
                    })
                  }
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="px-2 py-1">
            <p className="truncate text-sm font-semibold">
              {user?.email || "Operador"}
            </p>

            <p className="text-xs capitalize text-muted-foreground">
              {roles[0] ||
                "Sin rol asignado"}
            </p>
          </div>

          <Button
            onClick={() => signOut()}
            variant="ghost"
            className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-slate-50/50 p-4 pb-20 md:p-6 md:pb-6">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-card md:hidden"
        style={{
          paddingBottom:
            "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;

          const isActive =
            location.pathname.startsWith(
              item.path,
            );

          return (
            <button
              key={item.path}
              onClick={() =>
                goTo(item.path)
              }
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />

              <span className="max-w-[64px] truncate">
                {item.label}
              </span>
            </button>
          );
        })}

        {moreItems.length > 0 && (
          <button
            onClick={() =>
              setMoreOpen(true)
            }
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>Más</span>
          </button>
        )}
      </nav>

      <Sheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
      >
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl md:hidden"
        >
          <SheetHeader>
            <SheetTitle>
              Más opciones
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Sucursal Activa
              </label>

              <select
                value={branchId ?? ""}
                onChange={(event) =>
                  setBranchId(
                    event.target.value,
                  )
                }
                className="w-full rounded-lg border bg-background p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-primary"
              >
                {branches &&
                branches.length > 0 ? (
                  branches.map(
                    (branch) => (
                      <option
                        key={branch.id}
                        value={branch.id}
                      >
                        {branch.name}
                      </option>
                    ),
                  )
                ) : (
                  <option value="">
                    Cargando sucursales...
                  </option>
                )}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;

                const isActive =
                  location.pathname.startsWith(
                    item.path,
                  );

                return (
                  <button
                    key={item.path}
                    onClick={() =>
                      goTo(item.path)
                    }
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />

                    <span className="text-center leading-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border-t pt-3">
              <p className="truncate text-sm font-semibold">
                {user?.email ||
                  "Operador"}
              </p>

              <p className="mb-2 text-xs capitalize text-muted-foreground">
                {roles[0] ||
                  "Sin rol asignado"}
              </p>

              <Button
                onClick={() => signOut()}
                variant="ghost"
                className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}