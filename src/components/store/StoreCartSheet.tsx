import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/format";
import type { CartItem } from "@/lib/store/cart";

type StoreCartSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CartItem[];
  total: number;
  stockByProduct?: Map<string, number>;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  notes?: string;
  onCustomerNameChange?: (v: string) => void;
  onCustomerPhoneChange?: (v: string) => void;
  onAddressChange?: (v: string) => void;
  onNotesChange?: (v: string) => void;
  placing?: boolean;
  onPlaceOrder?: () => void;
  onIncrease: (productId: string) => void;
  onDecrease: (productId: string) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
};

export function StoreCartSheet({
  open,
  onOpenChange,
  items,
  total,
  stockByProduct,
  customerName = "",
  customerPhone = "",
  address = "",
  notes = "",
  onCustomerNameChange,
  onCustomerPhoneChange,
  onAddressChange,
  onNotesChange,
  placing = false,
  onPlaceOrder,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
}: StoreCartSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-rose-100 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-rose-100 px-5 py-4 text-left">
          <SheetTitle className="text-rose-950">Tu carrito</SheetTitle>
          <SheetDescription className="text-rose-400">
            Al confirmar se reserva stock del inventario compartido
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
                <ShoppingBag className="h-7 w-7 text-rose-300" />
              </div>
              <p className="text-sm font-medium text-rose-900">
                Tu carrito está vacío
              </p>
              <p className="text-xs text-rose-400">
                Agrega productos desde el catálogo
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {items.map((item) => {
                  const max = stockByProduct?.get(item.productId);
                  return (
                    <li
                      key={item.productId}
                      className="flex gap-3 rounded-xl border border-rose-50 bg-rose-50/40 p-3"
                    >
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white text-2xl shadow-sm">
                        {item.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-rose-950">
                          {item.name}
                        </p>
                        <p className="text-sm font-medium text-rose-600">
                          {money(item.price)}
                        </p>
                        {typeof max === "number" && (
                          <p className="text-[11px] text-rose-400">
                            {max} disponibles
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onDecrease(item.productId)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                            aria-label="Disminuir cantidad"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold text-rose-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onIncrease(item.productId)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                            aria-label="Aumentar cantidad"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(item.productId)}
                            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-rose-400 hover:bg-rose-100 hover:text-rose-600"
                            aria-label="Quitar del carrito"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-6 space-y-3 border-t border-rose-100 pt-4">
                <p className="text-sm font-semibold text-rose-900">
                  Datos de entrega
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nombre</Label>
                  <Input
                    value={customerName}
                    onChange={(e) => onCustomerNameChange?.(e.target.value)}
                    placeholder="Tu nombre"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">WhatsApp / Teléfono</Label>
                  <Input
                    value={customerPhone}
                    onChange={(e) => onCustomerPhoneChange?.(e.target.value)}
                    placeholder="10 dígitos"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Dirección</Label>
                  <Input
                    value={address}
                    onChange={(e) => onAddressChange?.(e.target.value)}
                    placeholder="Calle, colonia, ciudad"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notas</Label>
                  <Input
                    value={notes}
                    onChange={(e) => onNotesChange?.(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {items.length > 0 && (
          <SheetFooter className="flex-col gap-3 border-t border-rose-100 bg-white px-5 py-4 sm:flex-col">
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-rose-500">Total</span>
              <span className="text-xl font-bold text-rose-700">
                {money(total)}
              </span>
            </div>
            <Button
              type="button"
              disabled={placing || !onPlaceOrder}
              onClick={() => onPlaceOrder?.()}
              className="h-12 w-full rounded-full bg-rose-600 font-semibold text-white hover:bg-rose-700"
            >
              {placing ? "Creando pedido…" : "Confirmar pedido y reservar stock"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClear}
              disabled={placing}
              className="h-9 w-full text-rose-400 hover:bg-rose-50 hover:text-rose-600"
            >
              Vaciar carrito
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}