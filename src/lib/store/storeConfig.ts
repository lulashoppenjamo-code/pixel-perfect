/**
 * Configuración de la tienda en línea (banners, textos, colores, envío, etc.)
 * Se guarda en localStorage. No toca inventario ni RPCs.
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
};

export type StoreConfig = {
  theme: StoreTheme;
  banners: StoreBanner[];
  updatedAt: string;
};

const STORAGE_KEY = "lula-store-config-v1";

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  theme: {
    primary: "#e11d48",
    secondary: "#be123c",
    accent: "#f43f5e",
    background: "#fdf8f9",
    freeShippingFrom: 1199,
    freeShippingText: "ENVÍO GRATIS COMPRANDO $1,199 O MÁS",
    promoBarText: "Hasta 33% en acrílicos · 3 MSI con tarjeta",
    heroTitle: "Todo para tus uñas, en un solo lugar",
    heroSubtitle:
      "Catálogo profesional, envíos a todo México y seguimiento de pedidos en tiempo real.",
  },
  banners: [
    {
      id: "b1",
      title: "Hasta 33% en acrílicos",
      subtitle: "Resurtido de temporada",
      ctaText: "Ver acrílicos",
      ctaLink: "#",
      bgColor: "#e11d48",
      textColor: "#ffffff",
      active: true,
      order: 1,
    },
    {
      id: "b2",
      title: "Lo nuevo acaba de llegar",
      subtitle: "Colecciones de gel y efectos",
      ctaText: "Ver novedades",
      ctaLink: "#",
      bgColor: "#9f1239",
      textColor: "#ffffff",
      active: true,
      order: 2,
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