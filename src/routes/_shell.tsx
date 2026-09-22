/**
 * Shell layout — LULA OS (navegación estilo Zobaze POS)
 * Menús acomodados igual que Zobaze:
 *  - Móvil: barra inferior 5 pestañas (Reportes · Hoy · Counter · Items · Más)
 *  - Escritorio: sidebar con grupos Counter / Inventario / Operaciones / Más
 */
import { useEffect, useMemo, useState } from "react";
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
  MoreHorizontal,
  LayoutDashboard,
  X,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

type NavItem = {
  key: NavKey;
  to: string;
  label: string;
  shortLabel?: string;
  icon: typeof ShoppingCart;
};

/** Orden principal estilo Zobaze bottom-nav */
const PRIMARY_NAV: NavItem[] = [
  { key: "reportes", to: "/reportes", label: "Reportes", shortLabel: "Reportes", icon: BarChart3 },
  { key: "caja", to: "/caja", label: "Hoy / Caja", shortLabel: "Hoy", icon: LayoutDashboard },
  { key: "ventas", to: "/ventas", label: "Counter", shortLabel: "Counter", icon: ShoppingCart },
  { key: "productos", to: "/productos", label: "Items", shortLabel: "Items", icon: Package },
];

/** Resto de menús (van en "Más") — mismo orden lógico que Zobaze */
const MORE_NAV: NavItem[] = [
  { key: "inventario", to: "/inventario", label: "Inventario", icon: Boxes },
  { key: "clientes", to: "/clientes", label: "Clientes", icon: Users },
  { key: "compras", to: "/compras", label: "Compras", icon: Truck },
  { key: "gastos", to: "/gastos", label: "Gastos", icon: Receipt },
  { key: "devoluciones", to: "/devoluciones", label: "Devoluciones", icon: RotateCcw },
  { key: "pedidos", to: "/pedidos", label: "Pedidos online", icon: Store },
  { key: "ceo", to: "/ceo", label: "CEO IA", icon: Bot },
  { key: "ajustes", to: "/ajustes", label: "Ajustes", icon: Settings },
];

const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];

function ShellLayout() {
  const { user, loading, roles, signOut, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const primaryNav = useMemo(
    () => PRIMARY_NAV.filter((item) => canAccess(roles, item.key)),
    [roles],
  );
  const moreNav = useMemo(
    () => MORE_NAV.filter((item) => canAccess(roles, item.key)),
    [roles],
  );
  const fullNav = useMemo(
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
        primaryNav={primaryNav}
        moreNav={moreNav}
        fullNav={fullNav}
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
  primaryNav,
  moreNav,
  fullNav,
  profileName,
  onSignOut,
}: {
  primaryNav: NavItem[];
  moreNav: NavItem[];
  fullNav: NavItem[];
  profileName: string;
  onSignOut: () => void;
}) {
  const { branches, branchId, setBranchId } = useBranch();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreNav.some(
    (n) => pathname === n.to || pathname.startsWith(n.to + "/"),
  );

  return (
    <div className="flex min-h-screen flex-col bg-muted/40 md:flex-row">
      {/* ── Desktop sidebar (agrupado estilo Zobaze) ── */}
      <aside className="hidden shrink-0 flex-col border-r bg-card md:flex md:w-56">
        <div className="border-b px-4 py-4">
          <div className="text-lg font-bold tracking-tight text-primary">LULA OS</div>
          <div className="text-[11px] text-muted-foreground">Punto de venta</div>
        </div>

        {branches.length > 1 && (
          <div className="border-b px-3 py-2">
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

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {/* Grupo Counter */}
          <p className="mb-1 mt-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Counter
          </p>
          {fullNav
            .filter((n) => ["ventas", "caja"].includes(n.key))
            .map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} />
            ))}

          {/* Grupo Items / Stock */}
          <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Items & Stock
          </p>
          {fullNav
            .filter((n) => ["productos", "inventario", "compras"].includes(n.key))
            .map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} />
            ))}

          {/* Grupo Operaciones */}
          <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Operaciones
          </p>
          {fullNav
            .filter((n) =>
              ["clientes", "gastos", "devoluciones", "pedidos", "reportes"].includes(n.key),
            )
            .map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} />
            ))}

          {/* Grupo Más */}
          <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Más
          </p>
          {fullNav
            .filter((n) => ["ceo", "ajustes"].includes(n.key))
            .map((item) => (
              <NavLink key={item.to} item={item} pathname={pathname} />
            ))}
        </nav>

        <div className="border-t p-3">
          <p className="truncate px-1 text-xs text-muted-foreground">{profileName}</p>
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

      {/* ── Contenido principal ── */}
      <main className="min-w-0 flex-1 overflow-auto pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* ── Bottom nav móvil (exacto estilo Zobaze: 5 pestañas) ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card shadow-[0_-4px_20px_rgba(0,0,0,0.06)] md:hidden">
        {primaryNav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const isCenter = item.key === "ventas";
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              {isCenter ? (
                <span
                  className={cn(
                    "mb-0.5 flex h-11 w-11 -translate-y-3 items-center justify-center rounded-full shadow-lg transition-transform",
                    active
                      ? "bg-primary text-primary-foreground scale-105"
                      : "bg-primary/90 text-primary-foreground",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                </span>
              ) : (
                <item.icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
              )}
              <span className={cn(isCenter && "-mt-2")}>{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}

        {/* Pestaña Más */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
            isMoreActive || moreOpen ? "text-primary" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>Más</span>
        </button>
      </nav>

      {/* Sheet "Más" — menús secundarios */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-8">
          <SheetHeader className="border-b px-4 pb-3 text-left">
            <SheetTitle className="text-base">Más opciones</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 p-4">
            {moreNav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-muted/40 hover:bg-muted",
                  )}
                >
                  <item.icon className="h-6 w-6" />
                  <span className="text-xs font-medium leading-tight">{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="border-t px-4 pt-3">
            <p className="mb-2 text-xs text-muted-foreground">{profileName}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => {
                setMoreOpen(false);
                onSignOut();
              }}
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.to || pathname.startsWith(item.to + "/");
  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}
