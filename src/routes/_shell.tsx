import { createFileRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useBranch } from '@/lib/branch';
import { Button } from '@/components/ui/button';
import { 
  ShoppingBag, 
  Receipt, 
  Package, 
  Boxes, 
  Users, 
  TrendingUp, 
  Settings, 
  LogOut,
  AlertTriangle,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
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
  const { user, signOut } = useAuth();
  const { branchId, setBranchId, branches } = useBranch();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('sidebar-collapsed') === '1';
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  };

  const navItems = [
    { label: 'Caja (POS)', path: '/caja', icon: ShoppingBag },
    { label: 'Historial de ventas', path: '/ventas', icon: Receipt },
    { label: 'Productos', path: '/productos', icon: Package },
    { label: 'Inventario', path: '/inventario', icon: Boxes },
    { label: 'Clientes', path: '/clientes', icon: Users },
    { label: 'Reportes / CEO', path: '/reportes', icon: TrendingUp },
    { label: 'Ajustes', path: '/ajustes', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside
        className={`relative flex flex-col justify-between border-r bg-card p-4 select-none transition-all duration-200 ${
          collapsed ? 'w-[68px] px-2' : 'w-64'
        }`}
      >
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-accent"
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>

        <div className="space-y-6">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center px-0' : 'px-2'}`}>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl shadow-sm">
              L
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-bold text-lg leading-tight">Lula OS</h1>
                <p className="text-xs text-muted-foreground">Punto de Venta</p>
              </div>
            )}
          </div>

          {!collapsed && (
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
          )}

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate({ to: item.path })}
                  title={collapsed ? item.label : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
                  } ${
                    isActive 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'hover:bg-accent text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t pt-4 space-y-2">
          {!collapsed && (
            <div className="px-2 py-1">
              <p className="text-sm font-semibold truncate">{user?.email || 'Operador'}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role || 'Cajero'}</p>
            </div>
          )}
          <Button 
            onClick={() => signOut()} 
            variant="ghost" 
            title={collapsed ? 'Cerrar sesión' : undefined}
            className={`text-destructive hover:text-destructive hover:bg-destructive/10 ${
              collapsed ? 'w-full justify-center px-0' : 'w-full justify-start'
            }`}
          >
            <LogOut className={`w-4 h-4 ${collapsed ? '' : 'mr-2'}`} />
            {!collapsed && 'Cerrar Sesión'}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
        <Outlet />
      </main>
    </div>
  );
}
