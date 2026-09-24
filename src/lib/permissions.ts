/**
 * Permisos de navegación por rol — LULA OS
 * Ruta: src/lib/permissions.ts
 */

export type AppRole =
  | "owner"
  | "admin"
  | "manager"
  | "cashier"
  | "staff";

export type NavKey =
  | "ventas"
  | "productos"
  | "inventario"
  | "clientes"
  | "compras"
  | "caja"
  | "gastos"
  | "devoluciones"
  | "reportes"
  | "pedidos"
  | "reposicion"
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
    "gastos",
    "devoluciones",
    "reportes",
    "pedidos",
    "reposicion",
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
    "gastos",
    "devoluciones",
    "reportes",
    "pedidos",
    "reposicion",
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
    "gastos",
    "reportes",
    "devoluciones",
    "pedidos",
    "reposicion",
    "ceo",
  ],

  cashier: [
    "ventas",
    "clientes",
    "caja",
    "devoluciones",
    "reposicion",
  ],

  staff: [
    "ventas",
    "clientes",
    "reposicion",
  ],
};

export function canAccess(
  roles: AppRole[],
  key: NavKey,
): boolean {
  if (!roles.length) return false;

  return roles.some((role) =>
    ROLE_NAV[role]?.includes(key),
  );
}

export function filterNavByRoles<
  T extends { key: NavKey },
>(
  items: T[],
  roles: AppRole[],
): T[] {
  return items.filter((item) =>
    canAccess(roles, item.key),
  );
}

export function isAtLeastManager(
  roles: AppRole[],
): boolean {
  return roles.some(
    (role) =>
      role === "owner" ||
      role === "admin" ||
      role === "manager",
  );
}

export function isAtLeastAdmin(
  roles: AppRole[],
): boolean {
  return roles.some(
    (role) =>
      role === "owner" ||
      role === "admin",
  );
}