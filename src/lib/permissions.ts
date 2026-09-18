/**
 * Lula Shop OS — permisos por rol (FASE 1)
 * Ruta: src/lib/permissions.ts
 */
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type NavKey =
  | "ventas"
  | "productos"
  | "inventario"
  | "clientes"
  | "compras"
  | "caja"
  | "reportes"
  | "ajustes"
  | "devoluciones";

/** Qué rutas puede ver cada rol */
const ROLE_NAV: Record<AppRole, NavKey[]> = {
  owner: ["ventas", "productos", "inventario", "clientes", "compras", "caja", "reportes", "ajustes", "devoluciones"],
  admin: ["ventas", "productos", "inventario", "clientes", "compras", "caja", "reportes", "ajustes", "devoluciones"],
  manager: ["ventas", "productos", "inventario", "clientes", "compras", "caja", "reportes", "devoluciones"],
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
