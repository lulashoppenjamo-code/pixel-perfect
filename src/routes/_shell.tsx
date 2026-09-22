

/**
 * Shell — RÉPLICA ZOBAZE POS 1:1
 * Bottom nav: Reportes · Hoy · Counter · Items · Más
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ShoppingCart,
  Package,
  Boxes,
  Users,
  Truck,
  BarChart3,
  Settings,
  LogOut,
  RotateCcw,
  Store,
  Bot,
  Receipt,
  MoreHorizontal,
  LayoutDashboard,
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

const PRIMARY_NAV: NavItem[] = [
  { key: "reportes", to: "/reportes", label: "Reportes", shortLabel: "Reportes", icon: BarChart3 },
  { key: "caja", to: "/caja", label: "Hoy", shortLabel: "Hoy", icon: LayoutDashboard },
  { key: "ventas", to: "/ventas", label: "Counter", shortLabel: "Counter", icon: ShoppingCart },
  { key: "productos", to: "/productos", label: "Items", shortLabel: "Items", icon: Package },
];

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
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] text-muted-foreground">
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

  const storeName =
    branches.find((b) => b.id === branchId)?.name ?? "Mi tienda";

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f6fb] lg:flex-row">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[#e2e8f0] bg-white lg:flex">
        <div className="flex items-center gap-2 bg-[#4169e2] px-4 py-4 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-sm font-black">
            Z
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight">{storeName}</div>
            <div className="text-[10px] opacity-80">LULA OS · POS</div>
          </div>
        </div>

        {branches.length > 1 && (
          <div className="border-b border-[#e2e8f0] px-3 py-2">
            <Select value={branchId ?? undefined} onValueChange={setBranchId}>
              <SelectTrigger className="h-8 rounded-lg border-[#e2e8f0] text-xs">
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
          {(
            [
              { title: "Counter", keys: ["ventas", "caja"] },
              { title: "Items & Stock", keys: ["productos", "inventario", "compras"] },
              { title: "Operaciones", keys: ["clientes", "gastos", "devoluciones", "pedidos", "reportes"] },
              { title: "Más", keys: ["ceo", "ajustes"] },
            ] as const
          ).map((group) => (
            <div key={group.title}>
              <p className="mb-1 mt-2 px-2.5 text-[10px] font-bold uppercase tracking-wider text-[#9aa3b8]">
                {group.title}
              </p>
              {fullNav
                .filter((n) => (group.keys as readonly string[]).includes(n.key))
                .map((item) => (
                  <NavLink key={item.to} item={item} pathname={pathname} />
                ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-[#e2e8f0] p-3">
          <p className="truncate px-1 text-xs text-[#6b7280]">{profileName}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-2 text-[#6b7280]"
            onClick={onSignOut}
          >
            <LogOut className="h-4 w-4" />
            Salir
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto pb-[72px] lg:pb-0">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-[64px] items-end border-t border-[#e2e8f0] bg-white pb-1 shadow-[0_-6px_24px_rgba(0,0,0,0.06)] lg:hidden">
        {primaryNav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const isCenter = item.key === "ventas";
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold",
                active ? "text-[#4169e2]" : "text-[#9aa3b8]",
              )}
            >
              {isCenter ? (
                <span
                  className={cn(
                    "mb-0.5 flex h-14 w-14 -translate-y-5 items-center justify-center rounded-full bg-[#4169e2] text-white shadow-[0_6px_20px_rgba(65,105,226,0.45)]",
                    active && "ring-4 ring-[#4169e2]/25",
                  )}
                >
                  <item.icon className="h-6 w-6" strokeWidth={2.5} />
                </span>
              ) : (
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              )}
              <span className={cn(isCenter && "-mt-3")}>{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold",
            isMoreActive || moreOpen ? "text-[#4169e2]" : "text-[#9aa3b8]",
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>Más</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-0 px-0 pb-10">
          <SheetHeader className="border-b border-[#e2e8f0] px-5 pb-3 text-left">
            <SheetTitle className="text-base font-bold">Más</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-3 p-4">
            {moreNav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-colors",
                    active
                      ? "border-[#4169e2] bg-[#e8eefc] text-[#4169e2]"
                      : "border-[#e8ecf4] bg-white text-[#1a1d26] hover:border-[#4169e2]/40",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-2xl",
                      active ? "bg-[#4169e2] text-white" : "bg-[#eef1f8] text-[#4169e2]",
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold leading-tight">{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="border-t border-[#e2e8f0] px-5 pt-4">
            <p className="mb-2 text-xs text-[#6b7280]">{profileName}</p>
            <Button
              variant="outline"
              className="w-full gap-2 rounded-xl border-[#e2e8f0]"
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
        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-[#4169e2] text-white shadow-sm"
          : "text-[#4b5563] hover:bg-[#eef1f8] hover:text-[#1a1d26]",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}
