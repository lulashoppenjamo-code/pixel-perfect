import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Search, ShoppingCart, Trash2, CreditCard, Banknote, QrCode } from 'lucide-react';

export const Route = createFileRoute('/_shell/caja')({
  component: CajaPage,
});

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

function CajaPage() {
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);

  const products = [
    { id: '1', name: 'Pestañas Mink 3D', price: 120, code: '7501001' },
    { id: '2', name: 'Esmalte Gel UV Fuchsia', price: 85, code: '7501002' },
    { id: '3', name: 'Polvo Acrílico Cristal 2oz', price: 210, code: '7501003' },
    { id: '4', name: 'Lámpara LED UV 48W', price: 450, code: '7501004' },
  ];

  const addToCart = (product: typeof products[0]) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const total = cart.reduce((acc, item) => acc + item.price * item.qty, 0);

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-5rem)]">
      <div className="col-span-7 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 bg-background"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-1">
          {products.map((p) => (
            <Card 
              key={p.id} 
              onClick={() => addToCart(p)}
              className="cursor-pointer hover:border-primary transition-all shadow-none border active:scale-[0.98]"
            >
              <CardContent className="p-4 flex flex-col justify-between h-28">
                <div>
                  <h3 className="font-semibold text-sm line-clamp-1">{p.name}</h3>
                  <p className="text-xs text-muted-foreground">Código: {p.code}</p>
                </div>
                <p className="text-lg font-bold text-primary">${p.price.toFixed(2)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="col-span-5 bg-card border rounded-xl flex flex-col p-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b">
          <h2 className="font-bold flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Ticket Actual
          </h2>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setCart([])} 
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Vaciar
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
              <ShoppingCart className="w-10 h-10 mb-2 opacity-20" />
              Selecciona productos para vender
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm pb-2 border-b">
                <div className="flex-1">
                  <p className="font-medium line-clamp-1">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.qty} x ${item.price.toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold">${(item.price * item.qty).toFixed(2)}</span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeFromCart(item.id)}
                    className="h-7 w-7 text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex justify-between items-center text-xl font-bold">
            <span>Total:</span>
            <span className="text-primary">${total.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" className="flex flex-col h-14 text-xs gap-1">
              <Banknote className="w-4 h-4 text-emerald-600" />
              Efectivo
            </Button>
            <Button variant="outline" className="flex flex-col h-14 text-xs gap-1">
              <CreditCard className="w-4 h-4 text-blue-600" />
              Tarjeta
            </Button>
            <Button variant="outline" className="flex flex-col h-14 text-xs gap-1">
              <QrCode className="w-4 h-4 text-purple-600" />
              Transferencia
            </Button>
          </div>

          <Button disabled={cart.length === 0} className="w-full h-12 text-base font-bold">
            Cobrar ${total.toFixed(2)}
          </Button>
        </div>
      </div>
    </div>
  );
}
