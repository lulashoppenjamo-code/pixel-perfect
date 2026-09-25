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

async function loadUserProfile(
  uid: string,
): Promise<{
  profile: Profile | null;
  roles: AppRole[];
}> {
  /*
   * Primero intentamos asegurar que exista el perfil.
   *
   * Esta RPC no debe bloquear el acceso si falla,
   * porque el perfil puede existir correctamente.
   */
  const {
    error: ensureError,
  } = await supabase.rpc(
    "ensure_profile",
    {},
  );

  if (ensureError) {
    console.warn(
      "[LULA AUTH] ensure_profile no pudo ejecutarse:",
      ensureError,
    );
  }

  /*
   * Cargamos perfil y roles por separado.
   *
   * No ocultamos los errores de roles: si falla la
   * consulta, lo registramos claramente para poder
   * detectar problemas de RLS o sesión.
   */
  const profileResponse =
    await supabase
      .from("profiles")
      .select(
        "id, full_name, branch_id, is_active",
      )
      .eq("id", uid)
      .maybeSingle();

  if (profileResponse.error) {
    console.error(
      "[LULA AUTH] Error leyendo profiles:",
      profileResponse.error,
    );

    throw profileResponse.error;
  }

  const profile =
    (profileResponse.data as Profile | null) ??
    null;

  if (!profile) {
    console.warn(
      "[LULA AUTH] No existe perfil para el usuario:",
      uid,
    );

    return {
      profile: null,
      roles: [],
    };
  }

  /*
   * Si el perfil está inactivo, jamás concedemos
   * permisos aunque existan roles almacenados.
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

  /*
   * Ahora obtenemos los roles del usuario autenticado.
   */
  const rolesResponse =
    await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);

  if (rolesResponse.error) {
    console.error(
      "[LULA AUTH] Error leyendo user_roles:",
      rolesResponse.error,
    );

    throw rolesResponse.error;
  }

  const rawRoles =
    rolesResponse.data ?? [];

  const roles = rawRoles
    .map((item) => item?.role)
    .filter(isValidRole);

  /*
   * Diagnóstico útil sin exponer información sensible.
   */
  console.info(
    "[LULA AUTH] Acceso cargado:",
    {
      uid,
      active: profile.is_active,
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
  const [session, setSession] =
    useState<Session | null>(null);

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [roles, setRoles] =
    useState<AppRole[]>([]);

  const [loading, setLoading] =
    useState(true);

  /*
   * Carga de perfil asociada a una sesión concreta.
   */
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

      /*
       * Antes de actualizar el estado verificamos
       * que la sesión siga perteneciendo al mismo usuario.
       */
      const {
        data: sessionResponse,
      } =
        await supabase.auth.getSession();

      const currentUid =
        sessionResponse.session?.user
          ?.id ?? null;

      if (currentUid !== uid) {
        return;
      }

      setProfile(result.profile);
      setRoles(result.roles);
    } catch (error) {
      console.error(
        "[LULA AUTH] Error cargando permisos:",
        error,
      );

      setProfile(null);
      setRoles([]);
    }
  };

  useEffect(() => {
    let mounted = true;

    /*
     * Escuchamos cambios de autenticación.
     */
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

          /*
           * Esperamos al siguiente ciclo para evitar
           * consultas Supabase dentro del callback
           * interno de autenticación.
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

    /*
     * Recuperamos la sesión existente al arrancar.
     */
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

    isManager: roles.some(
      (role) =>
        role === "owner" ||
        role === "admin" ||
        role === "manager",
    ),

    isAdmin: roles.some(
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