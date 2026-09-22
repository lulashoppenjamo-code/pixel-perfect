import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
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
  Store,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
  errorComponent: ShellErrorComponent,
});

function ShellErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Error al cargar la sección</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        {error?.message || 'Ocurrió un problema de conexión o permisos al cargar este módulo.'}
      </p>
      <div className="flex gap-3">
        <Button onClick={() => reset()} variant="default">
          <RotateCcw className="w-4 h-4 mr-2" />
          Reintentar
        </Button>
        <Button onClick={() => window.location.href = '/caja'} variant="outline">
          Volver a Caja
        </Button>
      </div>
    </div>
  );
}

function ShellLayout() {
  const { user, signOut } = useAuth();
  const { currentBranch, setBranch, branches } = useBranch();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar Zobaze Style */}
      <aside className="w-64 bg-card border-r flex flex-col justify-between p-4">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
              L
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Lula OS</h1>
              <p className="text-xs text-muted-foreground">Punto de Venta</p>
            </div>
          </div>

          {/* Selector de Sucursal */}
          <div className="px-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              Sucursal Activa
            </label>
            <select 
              value={currentBranch?.id || ''} 
              onChange={(e) => setBranch(e.target.value)}
              className="w-[#100%] p-2 rounded-lg border bg-background text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Menú de Navegación */}
          <nav className="space-y-1">
            <button onClick={() => navigate({ to: '/caja' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <ShoppingBag className="w-4 h-4 text-primary" /> Caja (POS)
            </button>
            <button onClick={() => navigate({ to: '/ventas' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Receipt className="w-4 h-4" /> Historial Ventas
            </button>
            <button onClick={() => navigate({ to: '/productos' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Package className="w-4 h-4" /> Productos
            </button>
            <button onClick={() => navigate({ to: '/inventario' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Boxes className="w-4 h-4" /> Inventario
            </button>
            <button onClick={() => navigate({ to: '/clientes' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Users className="w-4 h-4" /> Clientes
            </button>
            <button onClick={() => navigate({ to: '/reportes' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <TrendingUp className="w-4 h-4" /> Reportes / CEO
            </button>
            <button onClick={() => navigate({ to: '/ajustes' })} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium hover:bg-accent transition-colors">
              <Settings className="w-4 h-4" /> Ajustes
            </button>
          </nav>
        </div>

        {/* Perfil y Salida */}
        <div className="border-t pt-4 space-y-2">
          <div className="px-2 py-1">
            <p className="text-sm font-semibold truncate">{user?.email || 'Usuario'}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role || 'Operador'}</p>
          </div>
          <Button onClick={() => signOut()} variant="ghost" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10">
            <LogOut className="w-4 h-4 mr-2" /> Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* Área Contenido */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
