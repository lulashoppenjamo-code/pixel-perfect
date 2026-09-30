import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type {
  Session,
  User,
} from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "owner"
  | "admin"
  | "manager"
  | "cashier"
  | "staff";

export type Profile = {
  id: string;
  full_name: string | null;
  branch_id: string | null;
  is_active: boolean;
};

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  permissions: Set<string> | null;
  loading: boolean;
  isManager: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext =
  createContext<AuthState | null>(null);

const VALID_ROLES: AppRole[] = [
  "owner",
  "admin",
  "manager",
  "cashier",
  "staff",
];

function isValidRole(
  value: unknown,
): value is AppRole {
  return (
    typeof value === "string" &&
    VALID_ROLES.includes(
      value as AppRole,
    )
  );
}

/**
 * Obtiene los roles reales del usuario autenticado.
 *
 * Mantiene exactamente los mecanismos existentes:
 * 1. get_my_roles()
 * 2. lectura de user_roles
 * 3. has_role()
 */
async function loadRoles(
  uid: string,
): Promise<AppRole[]> {
  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "get_my_roles",
    );

    if (!error) {
      const roles = Array.isArray(data)
        ? data.filter(isValidRole)
        : [];

      if (roles.length > 0) {
        return Array.from(
          new Set(roles),
        );
      }
    } else {
      console.warn(
        "[LULA AUTH] get_my_roles no disponible todavía:",
        error,
      );
    }
  } catch (error) {
    console.warn(
      "[LULA AUTH] Error en get_my_roles:",
      error,
    );
  }

  try {
    const {
      data,
      error,
    } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);

    if (!error) {
      const roles = (data ?? [])
        .map((item) => item?.role)
        .filter(isValidRole);

      if (roles.length > 0) {
        return Array.from(
          new Set(roles),
        );
      }
    } else {
      console.warn(
        "[LULA AUTH] Error leyendo user_roles:",
        error,
      );
    }
  } catch (error) {
    console.warn(
      "[LULA AUTH] Error consultando user_roles:",
      error,
    );
  }

  const detectedRoles: AppRole[] = [];

  for (const role of VALID_ROLES) {
    try {
      const {
        data,
        error,
      } = await supabase.rpc(
        "has_role",
        {
          _user_id: uid,
          _role: role,
        },
      );

      if (!error && data === true) {
        detectedRoles.push(role);
      }
    } catch (error) {
      console.warn(
        `[LULA AUTH] Error comprobando ${role}:`,
        error,
      );
    }
  }

  return Array.from(
    new Set(detectedRoles),
  );
}

/**
 * Carga los permisos granulares del usuario actual.
 *
 * IMPORTANTE:
 * - null = todavía no cargados / no se pudieron validar.
 * - Set vacío = permisos cargados correctamente y el usuario
 *   realmente no tiene permisos.
 *
 * Esto evita dejar toda la aplicación bloqueada si la migración
 * todavía no está disponible.
 */
async function loadPermissions(): Promise<{
  permissions: Set<string> | null;
  loaded: boolean;
}> {
  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "get_my_permissions",
    );

    if (error) {
      console.warn(
        "[LULA AUTH] get_my_permissions no disponible:",
        error,
      );

      return {
        permissions: null,
        loaded: false,
      };
    }

    if (!Array.isArray(data)) {
      return {
        permissions: new Set<string>(),
        loaded: true,
      };
    }

    const permissions =
      new Set<string>(
        data.filter(
          (value): value is string =>
            typeof value === "string",
        ),
      );

    return {
      permissions,
      loaded: true,
    };
  } catch (error) {
    console.warn(
      "[LULA AUTH] Error cargando permisos:",
      error,
    );

    return {
      permissions: null,
      loaded: false,
    };
  }
}

async function loadUserProfile(
  uid: string,
): Promise<{
  profile: Profile | null;
  roles: AppRole[];
  permissions: Set<string> | null;
}> {
  try {
    const {
      error,
    } = await supabase.rpc(
      "ensure_profile",
      {},
    );

    if (error) {
      console.warn(
        "[LULA AUTH] ensure_profile:",
        error,
      );
    }
  } catch (error) {
    console.warn(
      "[LULA AUTH] Error en ensure_profile:",
      error,
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, branch_id, is_active",
    )
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    console.error(
      "[LULA AUTH] Error leyendo profiles:",
      error,
    );

    throw error;
  }

  const profile =
    (data as Profile | null) ??
    null;

  if (!profile) {
    console.warn(
      "[LULA AUTH] No existe perfil:",
      uid,
    );

    return {
      profile: null,
      roles: [],
      permissions: null,
    };
  }

  if (profile.is_active !== true) {
    console.warn(
      "[LULA AUTH] Perfil inactivo:",
      uid,
    );

    return {
      profile,
      roles: [],
      permissions: new Set<string>(),