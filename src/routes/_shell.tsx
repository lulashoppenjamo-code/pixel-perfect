import { useState } from 'react';
import { createFileRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useBranch } from '@/lib/branch';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { filterNavByRoles, type NavKey } from '@/lib/permissions';
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
} from 'lucide-react';

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
  errorComponent: ShellErrorComponent,
});

function ShellErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-background">
      <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Error al cargar la sección</h2>
      <p className="text-muted-foreground max-w-md mb-6 text-sm">
        {error?.message || 'Ocurrió un problema al inicializar el módulo o la sesión de usuario.'}
      </p>
      <div className="flex gap-3">
        <Button onClick={() => reset()} variant="default">
          <RotateCcw className="w-4 h-4 mr-2" />
          Reintentar
        </Button>
        <Button onClick={() => window.location.href = '/auth'} variant="outline">
          Ir al Login
        </Button>
      </div>
    </div>
  );
}

function ShellLayout() {
  const { user, roles, signOut } = useAuth();
  const { branchId, setBranchId, branches } = useBranch();
  const navigate = useNavigate();
  const location = useLocation();

  // Todas las rutas reales que existen en src/routes/_shell.*.tsx.
  // Antes esta lista sólo tenía 7 de las 12 secciones existentes
  // (faltaban compras, gastos, devoluciones, pedidos y ceo, que ya
  // tenían página construida pero no eran alcanzables desde el menú).
  const allNavItems: { label: string; path: string; icon: typeof ShoppingBag; key: NavKey }[] = [
    { label: 'Caja (POS)', path: '/caja', icon: ShoppingBag, key: 'caja' },
    { label: 'Historial de ventas', path: '/ventas', icon: Receipt, key: 'ventas' },
    { label: 'Productos', path: '/productos', icon: Package, key: 'productos' },
    { label: 'Inventario', path: '/inventario', icon: Boxes, key: 'inventario' },
    { label: 'Compras', path: '/compras', icon: Truck, key: 'compras' },
    { label: 'Clientes', path: '/clientes', icon: Users, key: 'clientes' },
    { label: 'Devoluciones', path: '/devoluciones', icon: Undo2, key: 'devoluciones' },
    { label: 'Gastos', path: '/gastos', icon: Wallet, key: 'gastos' },
    { label: 'Pedidos', path: '/pedidos', icon: ClipboardList, key: 'pedidos' },
    { label: 'Reportes', path: '/reportes', icon: TrendingUp, key: 'reportes' },
    { label: 'CEO', path: '/ceo', icon: TrendingUp, key: 'ceo' },
    { label: 'Ajustes', path: '/ajustes', icon: Settings, key: 'ajustes' },
  ];

  // permissions.ts ya definía qué puede ver cada rol, pero nunca se
  // usaba en ningún lado del frontend: cualquier usuario autenticado
  // veía (y podía navegar directo por URL a) todas las secciones,
  // incluidas Ajustes o CEO. Se aplica aquí el filtro ya existente.
  const navItems = filterNavByRoles(allNavItems, roles);

  // F1 — navegación móvil: antes solo existía el sidebar de escritorio
  // (w-64, siempre visible), por lo que en celular ocupaba media
  // pantalla y no había forma pensada para dedo/pulgar de navegar.
  // Se reutilizan los mismos navItems ya filtrados por rol: los 4
  // más usados en el día a día de tienda van fijos abajo, el resto
  // (incluye Ajustes/CEO/Compras/etc., ya sean 1 o 7 según el rol)
  // vive en la hoja "Más".
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryKeys: NavKey[] = ['caja', 'ventas', 'inventario', 'clientes'];
  const primaryItems = navItems.filter((item) => primaryKeys.includes(item.key));
  const moreItems = navItems.filter((item) => !primaryKeys.includes(item.key));

  const goTo = (path: string) => {
    setMoreOpen(false);
    navigate({ to: path });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="hidden md:flex w-64 bg-card border-r flex-col justify-between p-4 select-none">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl shadow-sm">
              L
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Lula OS</h1>
              <p className="text-xs text-muted-foreground">Punto de Venta</p>
            </div>
          </div>

          <div className="px-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">
              Sucursal Activa
            </label>
            <select 
              value={branchId ?? ''} 
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full p-2.5 rounded-lg border bg-background text-sm font-medium focus:ring-2 focus:ring-primary outline-none cursor-pointer"
            >
              {branches && branches.length > 0 ? (
                branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))
              ) : (
                <option value="">Cargando sucursales...</option>
              )}
            </select>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate({ to: item.path })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'hover:bg-accent text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t pt-4 space-y-2">
          <div className="px-2 py-1">
            <p className="text-sm font-semibold truncate">{user?.email || 'Operador'}</p>
            {/* user.role viene del objeto de sesión de Supabase Auth
                (siempre "authenticated") y no del rol de negocio.
                El rol real vive en user_roles / AuthProvider.roles. */}
            <p className="text-xs text-muted-foreground capitalize">{roles[0] || 'Sin rol asignado'}</p>
          </div>
          <Button 
            onClick={() => signOut()} 
            variant="ghost" 
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-6 bg-slate-50/50">
        <Outlet />
      </main>

      {/* Navegación inferior — solo celular/tablet chico (< md) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => goTo(item.path)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate max-w-[64px]">{item.label}</span>
            </button>
          );
        })}
        {moreItems.length > 0 && (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>Más</span>
          </button>
        )}
      </nav>

      {/* Hoja "Más" — resto de secciones + sucursal + sesión, en celular */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Más opciones</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Sucursal Activa
              </label>
              <select
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full p-2.5 rounded-lg border bg-background text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
              >
                {branches && branches.length > 0 ? (
                  branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))
                ) : (
                  <option value="">Cargando sucursales...</option>
                )}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => goTo(item.path)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium ${
                      isActive ? 'border-primary bg-primary/10 text-primary' : 'text-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-center leading-tight">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t pt-3">
              <p className="text-sm font-semibold truncate">{user?.email || 'Operador'}</p>
              <p className="text-xs text-muted-foreground capitalize mb-2">{roles[0] || 'Sin rol asignado'}</p>
              <Button
                onClick={() => signOut()}
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Cerrar Sesión
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
