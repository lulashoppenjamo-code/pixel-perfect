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

import { InventoryAlerts } from "@/components/inventory/InventoryAlerts";

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
  Menu,
  BarChart3,
  CalendarDays,
  Crown,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Bottom nav estilo Zobaze: Informes · Hoy · Caja · Artículos · Más
  const bottomNavItems = [
    {
      label: "Informes",
      path: "/reportes",
      icon: BarChart3,
      key: "reportes" as NavKey,
    },
    {
      label: "Hoy",
      path: "/ventas",
      icon: CalendarDays,
      key: "ventas" as NavKey,
    },
    {
      label: "Caja",
      path: "/caja",
      icon: ShoppingBag,
      key: "caja" as NavKey,
    },
    {
      label: "Artículos",
      path: "/productos",
      icon: Package,
      key: "productos" as NavKey,
    },
  ].filter((item) =>
    navItems.some((n) => n.key === item.key),
  );

  const moreItems = navItems.filter(
    (item) =>
      !["reportes", "ventas", "caja", "productos"].includes(
        item.key,
      ),
  );

  const goTo = (path: string) => {
    setMoreOpen(false);
    setSidebarOpen(false);
    navigate({ to: path });
  };

  const openInventory = () => {
    navigate({
      to: "/inventario",
    });
  };

  const activeBranchName =
    branches.find((b) => b.id === branchId)?.name ||
    "Lula Shop";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ========== DESKTOP SIDEBAR ========== */}
      <aside className="hidden w-64 select-none flex-col justify-between border-r bg-card p-4 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a73e8] text-xl font-bold text-white shadow-sm">
              L
            </div>

            <div>
              <h1 className="text-lg font-bold leading-tight text-[#212121]">
                Lula OS
              </h1>

              <p className="text-xs text-[#757575]">
                Punto de Venta
              </p>
            </div>

            <div className="ml-auto">
              <InventoryAlerts
                compact
                onOpenInventory={openInventory}
              />
            </div>
          </div>

          <div className="px-2">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
              Sucursal Activa
            </label>

            <select
              value={branchId ?? ""}
              onChange={(event) =>
                setBranchId(event.target.value)
              }
              className="w-full cursor-pointer rounded-lg border border-[#e0e0e0] bg-white p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
            >
              {branches && branches.length > 0 ? (
                branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))
              ) : (
                <option value="">Cargando sucursales...</option>
              )}
            </select>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              const isActive = location.pathname.startsWith(
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
                      ? "bg-[#1a73e8] text-white shadow-sm"
                      : "text-[#212121] hover:bg-[#e8f0fe]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t border-[#e0e0e0] pt-4">
          <div className="px-2 py-1">
            <p className="truncate text-sm font-semibold text-[#212121]">
              {user?.email || "Operador"}
            </p>

            <p className="text-xs capitalize text-[#757575]">
              {roles[0] || "Sin rol asignado"}
            </p>
          </div>

          <Button
            onClick={() => signOut()}
            variant="ghost"
            className="w-full justify-start text-[#f44336] hover:bg-red-50 hover:text-[#f44336]"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* ========== MAIN CONTENT ========== */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ===== MOBILE TOP BAR (estilo Zobaze) ===== */}
        <header className="zb-topbar flex items-center gap-3 px-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 active:bg-white/10"
            aria-label="Menú"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight text-white">
              {activeBranchName}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <InventoryAlerts
              compact
              onOpenInventory={openInventory}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#f5f5f5] p-3 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* ===== MOBILE BOTTOM NAV (estilo Zobaze) ===== */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[#e0e0e0] bg-white md:hidden"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {bottomNavItems.map((item) => {
          const Icon = item.icon;

          const isActive = location.pathname.startsWith(
            item.path,
          );

          return (
            <button
              key={item.path}
              onClick={() => goTo(item.path)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                isActive
                  ? "text-[#1a73e8]"
                  : "text-[#757575]"
              }`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  isActive ? "bg-[#e8f0fe]" : ""
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${
                    isActive ? "text-[#1a73e8]" : ""
                  }`}
                />
              </div>
              <span className="max-w-[64px] truncate">
                {item.label}
              </span>
            </button>
          );
        })}

        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium text-[#757575]"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg">
              <MoreHorizontal className="h-5 w-5" />
            </div>
            <span>Más</span>
          </button>
        )}
      </nav>

      {/* ===== MOBILE SIDE MENU (hamburguesa) — estilo Zobaze ===== */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[300px] max-w-[88vw] overflow-y-auto p-0 md:hidden"
        >
          <div className="flex h-full flex-col">
            {/* Header azul con negocio */}
            <div className="bg-[#1a73e8] px-4 pb-5 pt-6 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                  L
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">
                    {activeBranchName}
                  </p>
                  <p className="text-xs text-white/80">
                    Lula Shop OS
                  </p>
                </div>
              </div>

              {/* Badge visual tipo PREMIUM (solo diseño) */}
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#7c4dff]/90 px-3 py-2">
                <Crown className="h-4 w-4 text-white" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-white">
                    Lula Shop OS
                  </p>
                  <p className="text-[11px] text-white/90">
                    Sistema propio · v1.0
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-0.5 p-3">
              <div className="mb-3">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Sucursal Activa
                </label>
                <select
                  value={branchId ?? ""}
                  onChange={(event) =>
                    setBranchId(event.target.value)
                  }
                  className="w-full rounded-lg border border-[#e0e0e0] bg-white p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
                >
                  {branches && branches.length > 0 ? (
                    branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))
                  ) : (
                    <option value="">Cargando...</option>
                  )}
                </select>
              </div>

              <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                Gestión
              </p>

              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(
                  item.path,
                );

                return (
                  <button
                    key={item.path}
                    onClick={() => goTo(item.path)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#1a73e8] text-white"
                        : "text-[#212121] hover:bg-[#e8f0fe]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="border-t border-[#e0e0e0] p-4">
              <p className="truncate text-sm font-semibold text-[#212121]">
                {user?.email || "Operador"}
              </p>
              <p className="mb-3 text-xs capitalize text-[#757575]">
                {roles[0] || "Sin rol asignado"}
              </p>
              <Button
                onClick={() => signOut()}
                variant="ghost"
                className="w-full justify-start text-[#f44336] hover:bg-red-50 hover:text-[#f44336]"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ===== MÁS (bottom sheet) — estilo Zobaze ===== */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-2xl border-0 p-0 md:hidden"
        >
          {/* Handle visual */}
          <div className="flex justify-center pt-3">
            <div className="h-1 w-10 rounded-full bg-[#e0e0e0]" />
          </div>

          <div className="px-4 pb-6 pt-3">
            <h2 className="mb-4 text-lg font-bold text-[#212121]">
              Más opciones
            </h2>

            {/* Sucursal */}
            <div className="mb-4">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                Sucursal Activa
              </label>
              <select
                value={branchId ?? ""}
                onChange={(event) =>
                  setBranchId(event.target.value)
                }
                className="w-full rounded-xl border border-[#e0e0e0] bg-white p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
              >
                {branches && branches.length > 0 ? (
                  branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))
                ) : (
                  <option value="">Cargando sucursales...</option>
                )}
              </select>
            </div>

            {/* Alertas */}
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[#e0e0e0] bg-white p-3.5 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-[#212121]">
                  Alertas de inventario
                </p>
                <p className="text-xs text-[#757575]">
                  Stock agotado o bajo mínimo
                </p>
              </div>
              <InventoryAlerts
                compact
                onOpenInventory={openInventory}
              />
            </div>

            {/* Grid de módulos estilo Zobaze */}
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
              Gestión
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(
                  item.path,
                );

                return (
                  <button
                    key={item.path}
                    onClick={() => goTo(item.path)}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-xs font-medium shadow-sm transition active:scale-[0.97] ${
                      isActive
                        ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                        : "border-[#e0e0e0] bg-white text-[#212121]"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        isActive
                          ? "bg-[#1a73e8] text-white"
                          : "bg-[#e8f0fe] text-[#1a73e8]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-center leading-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Usuario */}
            <div className="mt-5 border-t border-[#e0e0e0] pt-4">
              <p className="truncate text-sm font-semibold text-[#212121]">
                {user?.email || "Operador"}
              </p>
              <p className="mb-3 text-xs capitalize text-[#757575]">
                {roles[0] || "Sin rol asignado"}
              </p>
              <Button
                onClick={() => signOut()}
                variant="ghost"
                className="w-full justify-start text-[#f44336] hover:bg-red-50 hover:text-[#f44336]"
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