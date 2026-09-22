import { createFileRoute, Outlet, useNavigate, useLocation } from '@tanstack/react-router';
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
  RotateCcw
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
      <aside className="w-64 bg-card border-r flex flex-col justify-between p-4 select-none">
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
            <p className="text-xs text-muted-foreground capitalize">{user?.role || 'Cajero'}</p>
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

      <main className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
        <Outlet />
      </main>
    </div>
  );
}
