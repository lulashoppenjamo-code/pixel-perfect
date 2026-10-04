import { useState, useEffect } from "react";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useLocation,
  useRouter,
} from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";
import { autoConnectBluetoothPrinter } from "@/lib/bluetoothPrinter";
import {
  startGlobalBarcodeListener,
  setPendingBarcode,
  dispatchBarcode,
} from "@/lib/globalBarcode";

import { Button } from "@/components/ui/button";

import {
  Sheet,
  SheetContent,
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
  ChevronLeft,
  ChevronRight,
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
    <div className="flex min-h-screen min-w-0 flex-col items-center justify-center overflow-x-hidden bg-background p-4 text-center sm:p-6">
      <div className="mb-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:h-16 sm:w-16">
        <AlertTriangle className="h-7 w-7 sm:h-8 sm:w-8" />
      </div>

      <h2 className="mb-2 break-words text-xl font-bold sm:text-2xl">
        Error al cargar la sección
      </h2>

      <p className="mb-6 w-full max-w-md break-words text-sm leading-5 text-muted-foreground">
        {error?.message ||
          "Ocurrió un problema al inicializar el módulo o la sesión de usuario."}
      </p>

      <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center sm:gap-3">
        <Button
          onClick={() => reset()}
          className="min-h-11 w-full sm:w-auto"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>

        <Button
          onClick={() => {
            window.location.href = "/auth";
          }}
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
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

  // Conectar impresora Bluetooth en segundo plano al abrir la app
  useEffect(() => {
    let cancelled = false;

    const tryConnect = () => {
      if (cancelled) return;
      void autoConnectBluetoothPrinter();
    };

    tryConnect();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tryConnect();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    const t = window.setTimeout(tryConnect, 3000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(t);
    };
  }, []);

  const navigate = useNavigate();
  const location = useLocation();
  const router = useRouter();

  // Pistola de código de barras: cualquier pantalla → Caja y vender
  useEffect(() => {
    const stop = startGlobalBarcodeListener((code) => {
      setPendingBarcode(code);
      dispatchBarcode(code);
      if (!location.pathname.startsWith("/caja")) {
        navigate({ to: "/caja" });
      }
    });
    return stop;
  }, [navigate, location.pathname]);

  const preloadRoute = (path: string) => {
    void router
      .preloadRoute({
        to: path,
      })
      .catch(() => {
        // La navegación normal continúa aunque la precarga falle.
      });
  };

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

  const navItems = filterNavByRoles(allNavItems, roles);

  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* Colapso del sidebar (tablet/escritorio). Vive en el shell
     para no resetearse al cambiar de sección. */
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(true);

  /*
   * Navegación inferior solo para celular (< md).
   * Tablet y escritorio usan la sidebar fija.
   * Misma lógica de permisos/rutas.
   */
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
    <div className="flex h-[100dvh] min-h-0 min-w-0 overflow-hidden bg-background">
      {/* =====================================================
          SIDEBAR
          Se conserva para pantallas grandes.
          Celular/tablet utilizan navegación táctil.
          ===================================================== */}
      {/*
        Breakpoints de layout:
        - Celular (< md): top bar + bottom nav + sheet
        - Tablet (md–lg): sidebar fija, sin bottom nav
        - Escritorio (lg+): sidebar fija ancha
      */}
      <aside
        className={`hidden shrink-0 select-none flex-col justify-between border-r bg-card transition-[width] duration-200 ease-out md:flex ${
          sidebarCollapsed
            ? "w-[4.5rem] p-2"
            : "w-56 p-3 lg:w-64 lg:p-4"
        }`}
      >
        <div
          className={`min-h-0 overflow-y-auto overflow-x-hidden ${
            sidebarCollapsed
              ? "space-y-2"
              : "space-y-4 lg:space-y-6"
          }`}
        >
          {/* Header + toggle */}
          <div
            className={`flex items-center gap-2 ${
              sidebarCollapsed
                ? "flex-col px-0"
                : "min-w-0 gap-3 px-2"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1a73e8] text-xl font-bold text-white shadow-sm">
              L
            </div>

            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-bold leading-tight text-[#212121]">
                    Lula OS
                  </h1>
                  <p className="truncate text-xs text-[#757575]">
                    Punto de Venta
                  </p>
                </div>
                <div className="shrink-0">
                  <InventoryAlerts
                    compact
                    onOpenInventory={openInventory}
                  />
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() =>
                setSidebarCollapsed((value) => !value)
              }
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e0e0e0] bg-white text-[#424242] shadow-sm transition hover:bg-[#f5f5f5]"
              aria-label={
                sidebarCollapsed
                  ? "Abrir menú"
                  : "Cerrar menú"
              }
              title={
                sidebarCollapsed
                  ? "Abrir menú"
                  : "Cerrar menú"
              }
            >
              {sidebarCollapsed ? (
                <Menu className="h-5 w-5" />
              ) : (
                <ChevronLeft className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Marca — solo expandido */}
          {!sidebarCollapsed && (
            <div className="mx-2 flex min-w-0 items-center gap-2 rounded-lg bg-[#7c4dff]/90 px-3 py-2">
              <Crown className="h-4 w-4 shrink-0 text-white" />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold uppercase tracking-wide text-white">
                  Lula Shop OS
                </p>
                <p className="truncate text-[11px] text-white/90">
                  Sistema propio · v1.0
                </p>
              </div>
            </div>
          )}

          {/* Vender — siempre visible */}
          {navItems.some((item) => item.key === "caja") && (
            <div className={sidebarCollapsed ? "px-0" : "px-2"}>
              <button
                type="button"
                title="Vender"
                onPointerDown={() => preloadRoute("/caja")}
                onClick={() => navigate({ to: "/caja" })}
                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-sm font-bold shadow-sm transition-colors ${
                  location.pathname.startsWith("/caja")
                    ? "bg-[#34a853] text-white"
                    : "bg-[#1a73e8] text-white hover:bg-[#1557b0]"
                }`}
              >
                <ShoppingBag className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>Vender</span>}
              </button>
            </div>
          )}

          {/* Sucursal — solo expandido */}
          {!sidebarCollapsed && (
            <div className="px-2">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                Sucursal Activa
              </label>
              <select
                value={branchId ?? ""}
                onChange={(event) =>
                  setBranchId(event.target.value)
                }
                className="min-h-11 w-full cursor-pointer rounded-lg border border-[#e0e0e0] bg-white p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
              >
                {branches && branches.length > 0 ? (
                  branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
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
          )}

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(
                item.path,
              );

              return (
                <button
                  key={item.path}
                  type="button"
                  title={item.label}
                  onPointerDown={() => preloadRoute(item.path)}
                  onClick={() =>
                    navigate({
                      to: item.path,
                    })
                  }
                  className={`flex min-h-11 w-full items-center rounded-lg text-sm font-medium transition-colors ${
                    sidebarCollapsed
                      ? "justify-center px-0 py-2.5"
                      : "gap-3 px-3 py-2.5"
                  } ${
                    isActive
                      ? "bg-[#1a73e8] text-white shadow-sm"
                      : "text-[#212121] hover:bg-[#e8f0fe]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <span className="min-w-0 truncate">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div
          className={`border-t border-[#e0e0e0] pt-3 ${
            sidebarCollapsed ? "space-y-1" : "space-y-2 pt-4"
          }`}
        >
          {!sidebarCollapsed && (
            <div className="px-2 py-1">
              <p className="truncate text-sm font-semibold text-[#212121]">
                {user?.email || "Operador"}
              </p>
              <p className="text-xs capitalize text-[#757575]">
                {roles[0] || "Sin rol asignado"}
              </p>
            </div>
          )}

          <Button
            onClick={() => signOut()}
            variant="ghost"
            title="Cerrar sesión"
            className={`min-h-11 text-[#f44336] hover:bg-red-50 hover:text-[#f44336] ${
              sidebarCollapsed
                ? "w-full justify-center px-0"
                : "w-full justify-start"
            }`}
          >
            <LogOut
              className={`h-4 w-4 shrink-0 ${
                sidebarCollapsed ? "" : "mr-2"
              }`}
            />
            {!sidebarCollapsed && "Cerrar Sesión"}
          </Button>
        </div>
      </aside>

      {/* =====================================================
          CONTENIDO PRINCIPAL
          ===================================================== */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* ===== MOBILE / TABLET TOP BAR ===== */}
        <header className="zb-topbar flex min-h-14 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-4 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 active:bg-white/10"
            aria-label="Menú"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-white sm:text-[15px]">
              {location.pathname.startsWith("/productos")
                ? "Artículos"
                : location.pathname.startsWith("/caja")
                  ? "Caja"
                  : location.pathname.startsWith("/reportes")
                    ? "Informes"
                    : location.pathname.startsWith("/ventas")
                      ? "Hoy"
                      : activeBranchName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <InventoryAlerts
              compact
              onOpenInventory={openInventory}
            />
          </div>
        </header>

        <main
          className={
            location.pathname.startsWith("/caja")
              ? "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f5f5f5] pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:overflow-y-auto md:p-3 md:pb-3 lg:p-4 lg:pb-4"
              : "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f5f5f5] p-2.5 pb-[calc(3.75rem+env(safe-area-inset-bottom))] sm:p-4 md:p-4 md:pb-4 lg:p-6 lg:pb-6"
          }
        >
          <Outlet />
        </main>
      </div>

      {/* =====================================================
          MOBILE / TABLET BOTTOM NAV
          ===================================================== */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[#e0e0e0] bg-white md:hidden"
        style={{
          paddingBottom:
            "env(safe-area-inset-bottom, 0px)",
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
              type="button"
              onPointerDown={() => preloadRoute(item.path)}
              onClick={() => goTo(item.path)}
              className={`flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[10px] font-semibold transition-colors ${
                isActive
                  ? "bg-[#1a73e8] text-white"
                  : "bg-transparent text-[#5f6368]"
              }`}
            >
              <Icon
                className={`h-[22px] w-[22px] ${
                  isActive ? "text-white" : "text-[#5f6368]"
                }`}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              <span className="max-w-[72px] truncate leading-tight">
                {item.label}
              </span>
            </button>
          );
        })}

        {moreItems.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[10px] font-semibold text-[#5f6368]"
          >
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.75} />
            <span className="leading-tight">Más</span>
          </button>
        )}
      </nav>

      {/* =====================================================
          MOBILE / TABLET SIDE MENU
          ===================================================== */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[min(340px,88vw)] max-w-[88vw] overflow-y-auto overflow-x-hidden p-0 md:hidden"
        >
          <div className="flex min-h-full flex-col">
            <div className="bg-[#1a73e8] px-4 pb-5 pt-6 text-white sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                  L
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">
                    {activeBranchName}
                  </p>

                  <p className="truncate text-xs text-white/80">
                    Lula Shop OS
                  </p>
                </div>
              </div>

              <div className="mt-4 flex min-w-0 items-center gap-2 rounded-lg bg-[#7c4dff]/90 px-3 py-2">
                <Crown className="h-4 w-4 shrink-0 text-white" />

                <div className="min-w-0">
                  <p className="truncate text-xs font-bold uppercase tracking-wide text-white">
                    Lula Shop OS
                  </p>

                  <p className="truncate text-[11px] text-white/90">
                    Sistema propio · v1.0
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-3 sm:p-4">
              <div className="mb-3">
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                  Sucursal Activa
                </label>

                <select
                  value={branchId ?? ""}
                  onChange={(event) =>
                    setBranchId(event.target.value)
                  }
                  className="min-h-11 w-full rounded-lg border border-[#e0e0e0] bg-white p-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
                >
                  {branches && branches.length > 0 ? (
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
                      Cargando...
                    </option>
                  )}
                </select>
              </div>

              <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                Gestión
              </p>

              {navItems.map((item) => {
                const Icon = item.icon;

                const isActive =
                  location.pathname.startsWith(item.path);

                return (
                  <button
                    key={item.path}
                    type="button"
                    onPointerDown={() => preloadRoute(item.path)}
                    onClick={() => goTo(item.path)}
                    className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#1a73e8] text-white"
                        : "text-[#212121] hover:bg-[#e8f0fe]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />

                    <span className="min-w-0 truncate">
                      {item.label}
                    </span>
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
                className="min-h-11 w-full justify-start text-[#f44336] hover:bg-red-50 hover:text-[#f44336]"
              >
                <LogOut className="mr-2 h-4 w-4 shrink-0" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* =====================================================
          MÁS
          ===================================================== */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overflow-x-hidden rounded-t-2xl border-0 p-0 md:hidden"
        >
          <div className="flex justify-center pt-3">
            <div className="h-1 w-10 rounded-full bg-[#e0e0e0]" />
          </div>

          <div className="px-4 pb-6 pt-3 sm:px-6">
            <h2 className="mb-4 text-lg font-bold text-[#212121]">
              Más opciones
            </h2>

            <div className="mb-4">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                Sucursal Activa
              </label>

              <select
                value={branchId ?? ""}
                onChange={(event) =>
                  setBranchId(event.target.value)
                }
                className="min-h-12 w-full rounded-xl border border-[#e0e0e0] bg-white p-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#1a73e8]"
              >
                {branches && branches.length > 0 ? (
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

            <div className="mb-4 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[#e0e0e0] bg-white p-3.5 shadow-sm">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#212121]">
                  Alertas de inventario
                </p>

                <p className="truncate text-xs text-[#757575]">
                  Stock agotado o bajo mínimo
                </p>
              </div>

              <div className="shrink-0">
                <InventoryAlerts
                  compact
                  onOpenInventory={openInventory}
                />
              </div>
            </div>

            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
              Gestión
            </p>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
              {moreItems.map((item) => {
                const Icon = item.icon;

                const isActive =
                  location.pathname.startsWith(item.path);

                return (
                  <button
                    key={item.path}
                    type="button"
                    onPointerDown={() => preloadRoute(item.path)}
                    onClick={() => goTo(item.path)}
                    className={`flex min-h-28 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-xs font-medium shadow-sm transition active:scale-[0.97] ${
                      isActive
                        ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                        : "border-[#e0e0e0] bg-white text-[#212121]"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        isActive
                          ? "bg-[#1a73e8] text-white"
                          : "bg-[#e8f0fe] text-[#1a73e8]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    <span className="max-w-full break-words text-center leading-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

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
                className="min-h-11 w-full justify-start text-[#f44336] hover:bg-red-50 hover:text-[#f44336]"
              >
                <LogOut className="mr-2 h-4 w-4 shrink-0" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}