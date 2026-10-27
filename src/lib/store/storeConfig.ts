/**
 * Configuración completa de la tienda en línea Lula Shop.
 * Editable desde Pedidos → Config tienda. Se guarda en localStorage.
 */

export type StoreBanner = {
  id: string;
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  bgColor: string;
  textColor: string;
  active: boolean;
  order: number;
};

export type StoreReview = {
  id: string;
  name: string;
  city?: string;
  text: string;
  rating: number; // 1-5
  date?: string;
};

export type StoreTheme = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  freeShippingFrom: number;
  freeShippingText: string;
  promoBarText: string;
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
  trustLine: string;
  ratingValue: string;
  ratingCount: string;
  shippingNote: string;
  footerText: string;
};

export type StoreConfig = {
  theme: StoreTheme;
  banners: StoreBanner[];
  reviews: StoreReview[];
  updatedAt: string;
};

const STORAGE_KEY = "lula-store-config-v2";

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  theme: {
    primary: "#e11d48",
    secondary: "#9f1239",
    accent: "#f43f5e",
    background: "#faf7f8",
    freeShippingFrom: 1199,
    freeShippingText: "ENVÍO GRATIS COMPRANDO $1,199 O MÁS",
    promoBarText: "3 MSI con tarjeta · Productos profesionales para uñas",
    heroTitle: "Todo para tus uñas, en un solo lugar",
    heroSubtitle:
      "Catálogo profesional, mismos precios que en sucursal y seguimiento de pedidos en tiempo real.",
    heroCta: "Ver productos",
    trustLine: "Manicuristas confían en nosotros",
    ratingValue: "4.9",
    ratingCount: "2,400+",
    shippingNote: "Envíos a todo México · Entrega estimada 2 a 7 días hábiles",
    footerText: "Lula Shop · Tienda en línea oficial",
  },
  banners: [
    {
      id: "b1",
      title: "Hasta 33% en acrílicos",
      subtitle: "Resurtido de temporada para tu salón",
      ctaText: "Ver catálogo",
      ctaLink: "#catalogo",
      bgColor: "#e11d48",
      textColor: "#ffffff",
      active: true,
      order: 1,
    },
    {
      id: "b2",
      title: "Lo nuevo acaba de llegar",
      subtitle: "Geles, efectos y herramientas profesionales",
      ctaText: "Explorar",
      ctaLink: "#catalogo",
      bgColor: "#9f1239",
      textColor: "#ffffff",
      active: true,
      order: 2,
    },
  ],
  reviews: [
    {
      id: "r1",
      name: "Isabella A.",
      city: "Guadalajara",
      text: "Todo me llegó antes de lo planeado, es mi primera compra, la verdad volvería a pedir… todo muy hermoso.",
      rating: 5,
    },
    {
      id: "r2",
      name: "Ashly L.",
      city: "CDMX",
      text: "Todo llega súper rápido y en excelentes condiciones, cuidan cada detalle para que el producto llegue bien.",
      rating: 5,
    },
    {
      id: "r3",
      name: "Lucila T.",
      city: "Monterrey",
      text: "Gracias por estar siempre al pendiente, dar soluciones y respuestas inmediatas, excelente servicio.",
      rating: 5,
    },
    {
      id: "r4",
      name: "Jeanette A.",
      city: "Tijuana",
      text: "Tienen una variedad de productos enorme, y lo mejor es que encontré lo que siempre batallo para conseguir.",
      rating: 5,
    },
  ],
  updatedAt: new Date().toISOString(),
};

export function loadStoreConfig(): StoreConfig {
  if (typeof window === "undefined") return DEFAULT_STORE_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STORE_CONFIG;
    const parsed = JSON.parse(raw) as StoreConfig;
    return {
      ...DEFAULT_STORE_CONFIG,
      ...parsed,
      theme: { ...DEFAULT_STORE_CONFIG.theme, ...parsed.theme },
      banners: parsed.banners?.length
        ? parsed.banners
        : DEFAULT_STORE_CONFIG.banners,
      reviews: parsed.reviews?.length
        ? parsed.reviews
        : DEFAULT_STORE_CONFIG.reviews,
    };
  } catch {
    return DEFAULT_STORE_CONFIG;
  }
}

export function saveStoreConfig(config: StoreConfig) {
  if (typeof window === "undefined") return;
  const next = { ...config, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("lula-store-config-changed"));
}

export function subscribeStoreConfig(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("lula-store-config-changed", handler);
  return () => window.removeEventListener("lula-store-config-changed", handler);
}