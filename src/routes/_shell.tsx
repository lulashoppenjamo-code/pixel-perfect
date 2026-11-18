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
import { BluetoothPrinterGlobalButton } from "@/components/BluetoothPrinterGlobalButton";

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
  Crown,
  ChevronLeft,
  LayoutGrid,
  Store,
} from "lucide-react";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
  errorComponent: ShellErrorComponent as never,
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
      <h2 className="text-lg font-bold text-foreground sm:text-xl">
        Algo salió mal en esta sección
      </h2>
      <p className="mt-1.5 max-w-md text-xs text-muted-foreground sm:text-sm">
        {error.message || "Ocurrió un error inesperado al cargar la vista."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} size="sm" className="bg-[#1a73e8] text-white hover:bg-[#1557b0]">
          Reintentar
        </Button>
        <Button onClick={() => window.location.reload()} variant="outline" size="sm">
          Recargar la aplicación
        </Button>
      </div>
    </div>
  );
}

function ShellLayout() {
  const { user, profile, signOut, isOwner } = useAuth();
  const {
    branchId,
    setBranchId,
    branches,
  } = useBranch();

  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inventoryAlertsOpen, setInventoryAlertsOpen] = useState(false);

  useEffect(() => {
    // Auto-conexión Bluetooth silenciosa al iniciar el shell
    void autoConnectBluetoothPrinter();
  }, []);

  useEffect(() => {
    const cleanup = startGlobalBarcodeListener({
      onScan: (code) => {
        setPendingBarcode(code);
        dispatchBarcode(code);

        if (!location.pathname.startsWith("/caja") && !location.pathname.startsWith("/inventario")) {
          navigate({ to: "/caja" });
        }
      },
      minChars: 3,
      maxTimeMs: 120,
    });
    return cleanup;
  }, [location.pathname, navigate]);

  const allNavItems: {
    key: NavKey;
    label: string;
    path: string;
    icon: typeof ShoppingBag;
  }[] = [
    {
      key: "caja",
      label: "Caja",
      path: "/caja",
      icon: ShoppingBag,
    },
    {
      key: "ventas",
      label: "Hoy",
      path: "/ventas",
      icon: Receipt,
    },
    {
      key: "productos",
      label: "Artículos",
      path: "/productos",
      icon: Package,
    },
    {
      key: "inventario",
      label: "Inventario",
      path: "/inventario",
      icon: Boxes,
    },
    {
      key: "clientes",
      label: "Clientes",
      path: "/clientes",
      icon: Users,
    },
    {
      key: "compras",
      label: "Proveedores",
      path: "/compras",
      icon: Truck,
    },
    {
      key: "gastos",
      label: "Gastos",
      path: "/gastos",
      icon: Wallet,
    },
    {
      key: "devoluciones",
      label: "Devoluciones",
      path: "/devoluciones",
      icon: Undo2,
    },
    {
      key: "pedidos",
      label: "Pedidos",
      path: "/pedidos",
      icon: ClipboardList,
    },
    {
      key: "reportes",
      label: "Informes",
      path: "/reportes",
      icon: TrendingUp,
    },
    {
      key: "ajustes",
      label: "Ajustes",
      path: "/ajustes",
      icon: Settings,
    },
  ];

  const navItems = filterNavByRoles(
    allNavItems,
    profile?.role,
    Boolean(isOwner),
  );

  const bottomNavItems = [
    {
      key: "reportes" as NavKey,
      label: "Informes",
      path: "/reportes",
      icon: BarChart3,
    },
    {
      key: "ventas" as NavKey,
      label: "Hoy",
      path: "/ventas",
      icon: Receipt,
    },
    {
      key: "caja" as NavKey,
      label: "Caja",
      path: "/caja",
      icon: ShoppingCart,
    },
    {
      key: "inventario" as NavKey,
      label: "Inventario",
      path: "/inventario",
      icon: Boxes,
    },
  ];

  const moreItems = navItems.filter(
    (item) => !bottomNavItems.some((b) => b.key === item.key),
  );

  const [moreOpen, setMoreOpen] = useState(false);

  const handleNavClick = (path: string) => {
    setSidebarOpen(false);
    navigate({ to: path });
  };

  const openInventory = () => {
    setInventoryAlertsOpen(true);
  };

  const activeBranchName =
    branches.find((b) => b.id === branchId)?.name ||
    "Sucursal";

  const sessionName = profile?.full_name || user?.email || "Cajero";

  return (
    <div className="pixel-shell flex min-h-screen min-w-0 bg-[#f5f5f5] text-[#212121]">
      <style>{`
        .pixel-shell {
          --zb-topbar: #1a73e8;
        }
        .zb-topbar {
          background-color: var(--zb-topbar);
        }
        @media (display-mode: standalone), (max-width: 1024px) {
          .pixel-shell {
            padding-top: env(safe-area-inset-top, 0px);
          }
          .pixel-bottom-nav {
            padding-bottom: env(safe-area-inset-bottom, 0px);
          }
        }
      `}</style>

      {/* SIDEBAR DESKTOP */}
      <aside
        className={`hidden lg:flex flex-col border-r border-[#e0e0e0] bg-white transition-all duration-200 select-none ${
          sidebarCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#e0e0e0] px-4">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1a73e8] text-white font-bold text-lg">
                L
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#212121]">Lula Shop</p>
                <p className="truncate text-xs text-[#757575]">{activeBranchName}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#757575] hover:bg-[#f1f3f4]"
            title={sidebarCollapsed ? "Expandir" : "Contraer"}
          >
            <ChevronLeft className={`h-5 w-5 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Selector de Sucursal en Desktop */}
        {!sidebarCollapsed && branches.length > 0 && (
          <div className="p-3 border-b border-[#e0e0e0]">
            <select
              value={branchId ?? ""}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-lg border border-[#dadce0] bg-[#f8f9fa] px-3 py-2 text-xs font-medium text-[#212121] focus:border-[#1a73e8] focus:outline-none"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.path);
            return (
              <button
                key={item.key}
                onClick={() => handleNavClick(item.path)}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[#e8f0fe] text-[#1a73e8]"
                    : "text-[#424242] hover:bg-[#f8f9fa] hover:text-[#212121]"
                }`}
                title={item.label}
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? "text-[#1a73e8]" : "text-[#757575]"}`} />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#e0e0e0] p-3">
          <Button
            variant="ghost"
            onClick={() => void signOut()}
            className={`w-full justify-start gap-3 rounded-xl text-[#d93025] hover:bg-red-50 hover:text-[#d93025] ${
              sidebarCollapsed ? "px-3" : "px-3.5"
            }`}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!sidebarCollapsed && "Cerrar Sesión"}
          </Button>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* BARRA SUPERIOR */}
        <header
          className="pixel-topbar zb-topbar flex min-h-14 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-4 lg:hidden"
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 active:bg-white/10"
            aria-label="Menú"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight text-white">
              {location.pathname.startsWith("/productos")
                ? "Artículos"
                : location.pathname.startsWith("/caja")
                  ? sessionName
                    ? `${activeBranchName} · ${sessionName}`
                    : activeBranchName
                  : location.pathname.startsWith("/reportes")
                    ? "Informes"
                    : location.pathname.startsWith("/ventas")
                      ? "Hoy"
                      : location.pathname.startsWith("/gastos")
                        ? "Gastos"
                        : location.pathname.startsWith("/inventario")
                          ? "Inventario"
                          : location.pathname.startsWith("/clientes")
                            ? "Clientes"
                            : location.pathname.startsWith("/ajustes")
                              ? "Ajustes"
                              : activeBranchName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <BluetoothPrinterGlobalButton />
            <InventoryAlerts
              compact
              onOpenInventory={openInventory}
            />
          </div>
        </header>

        <main
          className={`pixel-main ${
            location.pathname.startsWith("/caja")
              ? "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f5f5f5] pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:overflow-hidden lg:p-0 lg:pb-0"
              : "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f5f5f5] p-2.5 pb-[calc(3.75rem+env(safe-area-inset-bottom))] sm:p-4 lg:p-6 lg:pb-6"
          }`}
        >
          <Outlet />
        </main>
      </div>

      {/* NAVEGACIÓN INFERIOR (MÓVIL / TABLET) */}
      <nav
        className="pixel-bottom-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[#e0e0e0] bg-white lg:hidden"
        style={{
          height: "3.75rem",
        }}
      >
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.key}
              onClick={() => navigate({ to: item.path })}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                active ? "text-[#1a73e8]" : "text-[#757575] hover:text-[#212121]"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-[#757575] hover:text-[#212121]"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="truncate">Más</span>
          </button>
        )}
      </nav>

      {/* MENÚ LATERAL MÓVIL (DRAWER) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          <div className="flex h-16 shrink-0 items-center border-b border-[#e0e0e0] px-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1a73e8] text-white font-bold text-lg">
                L
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#212121]">Lula Shop</p>
                <p className="truncate text-xs text-[#757575]">{activeBranchName}</p>
              </div>
            </div>
          </div>

          {branches.length > 0 && (
            <div className="p-3 border-b border-[#e0e0e0]">
              <select
                value={branchId ?? ""}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full rounded-lg border border-[#dadce0] bg-[#f8f9fa] px-3 py-2 text-xs font-medium text-[#212121]"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.key}
                  onClick={() => handleNavClick(item.path)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                    active ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#424242] hover:bg-[#f8f9fa]"
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${active ? "text-[#1a73e8]" : "text-[#757575]"}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-[#e0e0e0] p-3">
            <Button
              variant="ghost"
              onClick={() => void signOut()}
              className="w-full justify-start gap-3 rounded-xl px-3.5 text-[#d93025] hover:bg-red-50"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Cerrar Sesión
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* MODAL MÁS OPCIONES */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-base font-bold text-[#212121]">Más opciones</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {moreItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setMoreOpen(false);
                    navigate({ to: item.path });
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-[#e0e0e0] p-3 text-center transition-colors ${
                    active ? "bg-[#e8f0fe] border-[#1a73e8] text-[#1a73e8]" : "bg-white text-[#424242]"
                  }`}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-xs font-semibold truncate w-full">{item.label}</span>
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
