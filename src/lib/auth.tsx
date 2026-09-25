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

async function loadUserProfile(
  uid: string,
): Promise<{
  profile: Profile | null;
  roles: AppRole[];
}> {
  /*
   * ensure_profile solamente intenta crear el perfil
   * cuando realmente no existe.
   *
   * IMPORTANTE:
   * Un fallo de ensure_profile NO debe impedir que
   * carguemos un perfil que ya existe.
   *
   * Esto evita bloquear completamente el acceso si
   * la RPC tiene un problema de permisos o migración.
   */
  const { error: ensureError } =
    await supabase.rpc("ensure_profile", {});

  if (ensureError) {
    console.warn(
      "No se pudo ejecutar ensure_profile; se continuará cargando el perfil existente:",
      ensureError,
    );
  }

  /*
   * Cargar perfil y roles aunque ensure_profile
   * haya producido un error.
   */
  const [
    profileResult,
    rolesResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, branch_id, is_active",
      )
      .eq("id", uid)
      .maybeSingle(),

    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid),
  ]);

  if (profileResult.error) {
    throw profileResult.error;
  }

  if (rolesResult.error) {
    throw rolesResult.error;
  }

  const profile =
    (profileResult.data as Profile | null) ??
    null;

  /*
   * Un usuario inactivo nunca recibe permisos
   * aunque todavía tenga un rol almacenado.
   */
  if (!profile?.is_active) {
    return {
      profile,
      roles: [],
    };
  }

  const validRoles: AppRole[] = [
    "owner",
    "admin",
    "manager",
    "cashier",
    "staff",
  ];

  const roles = (
    (rolesResult.data ?? []) as {
      role: AppRole;
    }[]
  )
    .map((item) => item.role)
    .filter((role) =>
      validRoles.includes(role),
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

  const loadProfile = async (
    uid: string,
  ) => {
    try {
      const result =
        await loadUserProfile(uid);

      setProfile(result.profile);
      setRoles(result.roles);
    } catch (error) {
      console.error(
        "Error cargando perfil de usuario:",
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
          if (!mounted) return;

          setSession(nextSession);

          if (!nextSession?.user) {
            setProfile(null);
            setRoles([]);
            setLoading(false);
            return;
          }

          /*
           * No hacemos consultas complejas directamente
           * dentro del callback de Supabase.
           */
          setTimeout(() => {
            if (!mounted) return;

            void loadProfile(
              nextSession.user.id,
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
        if (!mounted) return;

        setSession(data.session);

        if (data.session?.user) {
          await loadProfile(
            data.session.user.id,
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
          "Error recuperando sesión:",
          error,
        );

        if (!mounted) return;

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
      if (!session?.user) {
        setProfile(null);
        setRoles([]);
        return;
      }

      await loadProfile(
        session.user.id,
      );
    },

    signOut: async () => {
      await supabase.auth.signOut();

      setSession(null);
      setProfile(null);
      setRoles([]);
    },
  };

  return (
    <AuthContext.Provider value={value}>
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