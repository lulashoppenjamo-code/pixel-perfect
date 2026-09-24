import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
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

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  isManager: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = useCallback(async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setProfile(null);
      setRoles([]);
      return;
    }

    const userId = currentSession.user.id;

    try {
      // Creates the profile for the first authenticated user when necessary.
      // This respects the database rules for active/inactive users.
      await supabase.rpc("ensure_profile", {});

      const [profileResult, rolesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, branch_id, is_active")
          .eq("id", userId)
          .maybeSingle(),

        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId),
      ]);

      if (profileResult.error) {
        console.error("Error loading profile:", profileResult.error);
      }

      if (rolesResult.error) {
        console.error("Error loading roles:", rolesResult.error);
      }

      setProfile(
        profileResult.data
          ? {
              id: profileResult.data.id,
              full_name: profileResult.data.full_name,
              branch_id: profileResult.data.branch_id,
              is_active: profileResult.data.is_active,
            }
          : null,
      );

      const validRoles: AppRole[] = [
        "owner",
        "admin",
        "manager",
        "cashier",
        "staff",
      ];

      const loadedRoles = (rolesResult.data ?? [])
        .map((item) => item.role as AppRole)
        .filter((role) => validRoles.includes(role));

      setRoles(loadedRoles);
    } catch (error) {
      console.error("Error loading authentication data:", error);
      setProfile(null);
      setRoles([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      setSession(currentSession);
      await loadUserData(currentSession);
    } finally {
      setLoading(false);
    }
  }, [loadUserData]);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        setSession(currentSession);
        await loadUserData(currentSession);
      } catch (error) {
        console.error("Auth initialization error:", error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;

      setLoading(true);
      setSession(newSession);

      try {
        await loadUserData(newSession);
      } catch (error) {
        console.error("Auth state change error:", error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserData]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRoles([]);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      roles,
      loading,
      isManager: roles.includes("owner") ||
        roles.includes("admin") ||
        roles.includes("manager"),
      isAdmin: roles.includes("owner") || roles.includes("admin"),
      refresh,
      signOut,
    }),
    [session, profile, roles, loading, refresh, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}