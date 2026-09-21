/**
 * Permisos de navegación por rol — LULA OS
 * Ruta: src/lib/permissions.ts
 */
export type AppRole = "owner" | "admin" | "manager" | "cashier" | "staff";

export type NavKey =
  | "ventas"
  | "productos"
  | "inventario"
  | "clientes"
  | "compras"
  | "caja"
  | "devoluciones"
  | "reportes"
  | "pedidos"
  | "ceo"
  | "ajustes";

const ROLE_NAV: Record<AppRole, NavKey[]> = {
  owner: [
    "ventas",
    "productos",
    "inventario",
    "clientes",
    "compras",
    "caja",
    "devoluciones",
    "reportes",
    "pedidos",
    "ceo",
    "ajustes",
  ],
  admin: [
    "ventas",
    "productos",
    "inventario",
    "clientes",
    "compras",
    "caja",
    "devoluciones",
    "reportes",
    "pedidos",
    "ceo",
    "ajustes",
  ],
  manager: [
    "ventas",
    "productos",
    "inventario",
    "clientes",
    "compras",
    "caja",
    "reportes",
    "devoluciones",
    "pedidos",
    "ceo",
  ],
  cashier: ["ventas", "clientes", "caja", "devoluciones"],
  staff: ["ventas", "clientes"],
};

export function canAccess(roles: AppRole[], key: NavKey): boolean {
  if (!roles.length) return false;
  return roles.some((r) => ROLE_NAV[r]?.includes(key));
}

export function filterNavByRoles<T extends { key: NavKey }>(items: T[], roles: AppRole[]): T[] {
  return items.filter((item) => canAccess(roles, item.key));
}

export function isAtLeastManager(roles: AppRole[]): boolean {
  return roles.some((r) => r === "owner" || r === "admin" || r === "manager");
}

export function isAtLeastAdmin(roles: AppRole[]): boolean {
  return roles.some((r) => r === "owner" || r === "admin");
}
