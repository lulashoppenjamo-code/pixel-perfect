/**
 * Permisos de navegación y acciones — LULA OS
 *
 * v1.1
 *
 * IMPORTANTE:
 * - Conserva los roles existentes.
 * - Conserva las funciones públicas usadas por el proyecto.
 * - No modifica inventario.
 * - No modifica ventas.
 * - No modifica caja.
 * - Los permisos reales se validan también en Supabase.
 */

import type {
  SupabaseClient,
} from "@supabase/supabase-js";

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

export type PermissionKey =
  | "ventas.view"
  | "ventas.create"
  | "ventas.cancel"
  | "ventas.discount"
  | "productos.view"
  | "productos.create"
  | "productos.edit"
  | "productos.delete"
  | "productos.price"
  | "inventario.view"
  | "inventario.adjust"
  | "inventario.physical_count"
  | "clientes.view"
  | "clientes.create"
  | "clientes.edit"
  | "clientes.credit"
  | "clientes.credit_payment"
  | "compras.view"
  | "compras.create"
  | "compras.receive"
  | "caja.view"
  | "caja.open"
  | "caja.close"
  | "caja.movement"
  | "gastos.view"
  | "gastos.create"
  | "gastos.edit"
  | "gastos.delete"
  | "devoluciones.view"
  | "devoluciones.create"
  | "pedidos.view"
  | "pedidos.create"
  | "pedidos.edit"
  | "reposicion.view"
  | "reposicion.create"
  | "reposicion.receive"
  | "reportes.view"
  | "ceo.view"
  | "ajustes.view"
  | "ajustes.manage"
  | "usuarios.view"
  | "usuarios.manage";

const ROLE_NAV: Record<
  AppRole,
  NavKey[]
> = {
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

const NAV_PERMISSION: Record<
  NavKey,
  PermissionKey
> = {
  ventas: "ventas.view",
  productos: "productos.view",
  inventario: "inventario.view",
  clientes: "clientes.view",
  compras: "compras.view",
  caja: "caja.view",
  gastos: "gastos.view",
  devoluciones: "devoluciones.view",
  reportes: "reportes.view",
  pedidos: "pedidos.view",
  reposicion: "reposicion.view",
  ceo: "ceo.view",
  ajustes: "ajustes.view",
};

export function canAccess(
  roles: AppRole[],
  key: NavKey,
  permissions?: Iterable<string>,
): boolean {
  if (!roles.length) {
    return false;
  }

  /*
   * Cuando los permisos del backend ya fueron
   * cargados, estos tienen prioridad.
   */
  if (permissions) {
    const set =
      permissions instanceof Set
        ? permissions
        : new Set(permissions);

    return set.has(
      NAV_PERMISSION[key],
    );
  }

  /*
   * Compatibilidad con el comportamiento
   * existente mientras AuthProvider carga.
   */
  return roles.some((role) =>
    ROLE_NAV[role]?.includes(key),
  );
}

export function canPerform(
  permissions: Iterable<string>,
  permission: PermissionKey,
): boolean {
  if (!permissions) {
    return false;
  }

  if (permissions instanceof Set) {
    return permissions.has(permission);
  }

  return Array.from(
    permissions,
  ).includes(permission);
}

export function filterNavByRoles<
  T extends { key: NavKey },
>(
  items: T[],
  roles: AppRole[],
  permissions?: Iterable<string>,
): T[] {
  return items.filter((item) =>
    canAccess(
      roles,
      item.key,
      permissions,
    ),
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

export async function loadMyPermissions(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "get_my_permissions",
    );

    if (error) {
      console.warn(
        "[LULA PERMISSIONS] No se pudieron cargar permisos:",
        error,
      );

      return new Set();
    }

    if (!Array.isArray(data)) {
      return new Set();
    }

    return new Set(
      data.filter(
        (value): value is string =>
          typeof value === "string",
      ),
    );
  } catch (error) {
    console.warn(
      "[LULA PERMISSIONS] Error cargando permisos:",
      error,
    );

    return new Set();
  }
}

export async function checkPermission(
  supabase: SupabaseClient,
  permission: PermissionKey,
): Promise<boolean> {
  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "has_permission",
      {
        _permission_key:
          permission,
      },
    );

    if (error) {
      console.warn(
        "[LULA PERMISSIONS] Error comprobando permiso:",
        error,
      );

      return false;
    }

    return data === true;
  } catch (error) {
    console.warn(
      "[LULA PERMISSIONS] Error comprobando permiso:",
      error,
    );

    return false;
  }
}

export function getNavPermission(
  key: NavKey,
): PermissionKey {
  return NAV_PERMISSION[key];
}