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
 * Primero usa get_my_roles(), una función SECURITY DEFINER
 * que consulta user_roles sin depender de las políticas RLS.
 *
 * Después utiliza user_roles directamente como respaldo.
 *
 * Finalmente intenta has_role() para compatibilidad
 * con instalaciones anteriores.
 */
async function loadRoles(
  uid: string,
): Promise<AppRole[]> {
  /**
   * MÉTODO PRINCIPAL
   *
   * get_my_roles() siempre trabaja con auth.uid()
   * y por seguridad no confía únicamente en el uid enviado
   * desde el navegador.
   */
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

  /**
   * RESPALDO 1
   *
   * Lectura directa del rol propio.
   */
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

  /**
   * RESPALDO 2
   *
   * Compatibilidad con versiones anteriores
   * de la base de datos.
   */
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

async function loadUserProfile(
  uid: string,
): Promise<{
  profile: Profile | null;
  roles: AppRole[];
}> {
  /**
   * Intentar crear el perfil si todavía no existe.
   */
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

  /**
   * Leer perfil propio.
   */
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
    };
  }

  /**
   * Un usuario inactivo nunca recibe permisos.
   */
  if (profile.is_active !== true) {
    console.warn(
      "[LULA AUTH] Perfil inactivo:",
      uid,
    );

    return {
      profile,
      roles: [],
    };
  }

  const roles =
    await loadRoles(uid);

  console.info(
    "[LULA AUTH] ACCESO FINAL",
    {
      uid,
      active: profile.is_active,
      branchId: profile.branch_id,
      roles,
      roleCount: roles.length,
    },
  );

  return {
    profile,
    roles,
  };
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [
    session,
    setSession,
  ] = useState<Session | null>(null);

  const [
    profile,
    setProfile,
  ] = useState<Profile | null>(null);

  const [
    roles,
    setRoles,
  ] = useState<AppRole[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const loadProfile = async (
    currentSession: Session | null,
  ) => {
    if (!currentSession?.user) {
      setProfile(null);
      setRoles([]);
      return;
    }

    const uid =
      currentSession.user.id;

    try {
      const result =
        await loadUserProfile(uid);

      /**
       * Evitar aplicar permisos de una sesión
       * que ya cambió.
       */
      const {
        data,
      } =
        await supabase.auth.getSession();

      const currentUid =
        data.session?.user?.id ??
        null;

      if (currentUid !== uid) {
        return;
      }

      setProfile(result.profile);
      setRoles(result.roles);
    } catch (error) {
      console.error(
        "[LULA AUTH] Error cargando perfil:",
        error,
      );

      setProfile(null);
      setRoles([]);
    }
  };

  useEffect(() => {
    let mounted = true;

    const {
      data: subscription,
    } =
      supabase.auth.onAuthStateChange(
        (_event, nextSession) => {
          if (!mounted) {
            return;
          }

          setSession(nextSession);

          if (!nextSession?.user) {
            setProfile(null);
            setRoles([]);
            setLoading(false);
            return;
          }

          /**
           * No hacemos consultas Supabase directamente
           * dentro del callback de Auth.
           */
          setTimeout(() => {
            if (!mounted) {
              return;
            }

            void loadProfile(
              nextSession,
            ).finally(() => {
              if (mounted) {
                setLoading(false);
              }
            });
          }, 0);
        },
      );

    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) {
          return;
        }

        const nextSession =
          data.session ?? null;

        setSession(nextSession);

        if (nextSession?.user) {
          await loadProfile(
            nextSession,
          );
        } else {
          setProfile(null);
          setRoles([]);
        }

        if (mounted) {
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error(
          "[LULA AUTH] Error recuperando sesión:",
          error,
        );

        if (!mounted) {
          return;
        }

        setSession(null);
        setProfile(null);
        setRoles([]);
        setLoading(false);
      });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,

    user:
      session?.user ?? null,

    profile,

    roles,

    loading,

    isManager:
      roles.some(
        (role) =>
          role === "owner" ||
          role === "admin" ||
          role === "manager",
      ),

    isAdmin:
      roles.some(
        (role) =>
          role === "owner" ||
          role === "admin",
      ),

    refresh: async () => {
      const {
        data,
      } =
        await supabase.auth.getSession();

      const currentSession =
        data.session ?? null;

      setSession(currentSession);

      if (!currentSession?.user) {
        setProfile(null);
        setRoles([]);
        return;
      }

      setLoading(true);

      try {
        await loadProfile(
          currentSession,
        );
      } finally {
        setLoading(false);
      }
    },

    signOut: async () => {
      const {
        error,
      } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setSession(null);
      setProfile(null);
      setRoles([]);
    },
  };

  return (
    <AuthContext.Provider
      value={value}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider",
    );
  }

  return context;
}