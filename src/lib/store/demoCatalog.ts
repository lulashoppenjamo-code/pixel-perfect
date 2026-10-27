
/**
 * Tipos y catálogo de DEMOSTRACIÓN para la tienda pública.
 * Los productos reales se obtienen de getSharedInventory().
 * DEMO_PRODUCTS solo se mantiene por compatibilidad / pruebas locales.
 */

export type StoreProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  emoji: string;
  /** URL de la fotografía real del producto (si existe). */
  image_url?: string | null;
  available: boolean;
  description?: string;
};

export const STORE_CATEGORIES = [
  "Todos",
  "Uñas",
  "Cuidado",
  "Herramientas",
  "Kits",
] as const;

export type StoreCategory = (typeof STORE_CATEGORIES)[number];

export const DEMO_PRODUCTS: StoreProduct[] = [
  {
    id: "demo-1",
    name: "Esmalte gel rosa suave",
    category: "Uñas",
    price: 89,
    emoji: "💅",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-2",
    name: "Base fortalecedora",
    category: "Cuidado",
    price: 120,
    emoji: "✨",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-3",
    name: "Lima profesional 180/180",
    category: "Herramientas",
    price: 25,
    emoji: "🔧",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-4",
    name: "Kit manicure básico",
    category: "Kits",
    price: 349,
    emoji: "🎁",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-5",
    name: "Top coat brillo intenso",
    category: "Uñas",
    price: 95,
    emoji: "💎",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-6",
    name: "Aceite de cutícula",
    category: "Cuidado",
    price: 55,
    emoji: "🧴",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-7",
    name: "Pincel detallista",
    category: "Herramientas",
    price: 40,
    emoji: "🖌️",
    available: false,
    description: "Producto de demostración — sin stock",
  },
  {
    id: "demo-8",
    name: "Kit gel completo",
    category: "Kits",
    price: 599,
    emoji: "📦",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-9",
    name: "Esmalte nude clásico",
    category: "Uñas",
    price: 89,
    emoji: "🤍",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-10",
    name: "Removedor suave",
    category: "Cuidado",
    price: 70,
    emoji: "🫧",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-11",
    name: "Cortacutículas",
    category: "Herramientas",
    price: 65,
    emoji: "✂️",
    available: true,
    description: "Producto de demostración",
  },
  {
    id: "demo-12",
    name: "Set decoración uñas",
    category: "Kits",
    price: 180,
    emoji: "🌸",
    available: false,
    description: "Producto de demostración — sin stock",
  },
];