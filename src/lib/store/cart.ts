/**
 * Carrito visual local (FASE 2).
 * Solo localStorage. No crea pedidos ni reserva existencias.
 */

import type { StoreProduct } from "./demoCatalog";

const STORAGE_KEY = "lula-store-cart-v1";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  emoji: string;
  quantity: number;
};

function readRaw(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.productId === "string" &&
        typeof item.quantity === "number" &&
        item.quantity > 0,
    );
  } catch {
    return [];
  }
}

function writeRaw(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("lula-store-cart-changed"));
  } catch {
    // ignore quota errors
  }
}

export function getCartItems(): CartItem[] {
  return readRaw();
}

export function getCartCount(): number {
  return readRaw().reduce((sum, item) => sum + item.quantity, 0);
}

export function getCartTotal(): number {
  return readRaw().reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
}

export function addToCart(product: StoreProduct, qty = 1): CartItem[] {
  if (!product.available) return readRaw();
  const items = readRaw();
  const existing = items.find((i) => i.productId === product.id);
  const quantity = Math.max(1, Math.floor(qty));

  let next: CartItem[];
  if (existing) {
    next = items.map((i) =>
      i.productId === product.id
        ? { ...i, quantity: i.quantity + quantity }
        : i,
    );
  } else {
    next = [
      ...items,
      {
        productId: product.id,
        name: product.name,
        price: product.price,
        emoji: product.emoji,
        quantity,
      },
    ];
  }
  writeRaw(next);
  return next;
}

export function setCartQuantity(productId: string, quantity: number): CartItem[] {
  const qty = Math.floor(quantity);
  let next: CartItem[];
  if (qty <= 0) {
    next = readRaw().filter((i) => i.productId !== productId);
  } else {
    next = readRaw().map((i) =>
      i.productId === productId ? { ...i, quantity: qty } : i,
    );
  }
  writeRaw(next);
  return next;
}

export function removeFromCart(productId: string): CartItem[] {
  const next = readRaw().filter((i) => i.productId !== productId);
  writeRaw(next);
  return next;
}

export function clearCart(): void {
  writeRaw([]);
}

export function subscribeCart(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  const onCustom = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("lula-store-cart-changed", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("lula-store-cart-changed", onCustom);
  };
}