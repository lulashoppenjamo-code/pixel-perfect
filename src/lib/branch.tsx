import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
};

type UserBranchAccessRow = {
  user_id: string;
  branch_id: string;
};

type BranchState = {
  branches: Branch[];
  branchId: string | null;
  setBranchId: (id: string) => void;
  loading: boolean;
};

const Ctx = createContext<BranchState | null>(null);

const STORAGE_KEY = "lula-os-active-branch";

export function useBranches() {
  const { user, profile } = useAuth();

  return useQuery({
    queryKey: ["branches", user?.id],

    enabled:
      !!user &&
      !!profile &&
      profile.is_active === true,

    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select(
          "id, name, address, phone, is_active",
        )
        .eq("is_active", true)
        .order("name");

      if (error) {
        throw error;
      }

      return (data ?? []) as Branch[];
    },
  });
}

/*
 * Sucursales adicionales autorizadas para el usuario.
 *
 * IMPORTANTE:
 * - Owner/admin no necesitan esta consulta porque ya
 *   tienen acceso a todas las sucursales activas.
 * - El filtro user_id garantiza que el cliente solamente
 *   utilice las asignaciones del usuario actual.
 * - La seguridad real continúa estando en RLS y
 *   can_access_branch().
 */
function useUserBranchAccess() {
  const { user, profile, roles } = useAuth();

  const isOwnerOrAdmin =
    roles.includes("owner") ||
    roles.includes("admin");

  return useQuery({
    queryKey: [
      "user-branch-access",
      user?.id,
    ],

    enabled:
      !!user &&
      !!profile &&
      profile.is_active === true &&
      !isOwnerOrAdmin,

    queryFn: async () => {
      if (!user?.id) {
        return [] as UserBranchAccessRow[];
      }

      const {
        data,
        error,
      } = await supabase
        .from("user_branch_access")
        .select(
          "user_id, branch_id",
        )
        .eq(
          "user_id",
          user.id,
        );

      if (error) {
        throw error;
      }

      return (
        data ?? []
      ) as UserBranchAccessRow[];
    },
  });
}

function readStoredBranchId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return (
      window.localStorage.getItem(
        STORAGE_KEY,
      ) || null
    );
  } catch {
    return null;
  }
}

function writeStoredBranchId(
  branchId: string | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (branchId) {
      window.localStorage.setItem(
        STORAGE_KEY,
        branchId,
      );
    } else {
      window.localStorage.removeItem(
        STORAGE_KEY,
      );
    }
  } catch {
    // El sistema sigue funcionando aunque localStorage no esté disponible.
  }
}

export function BranchProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    profile,
    roles,
    user,
  } = useAuth();

  const {
    data: allBranches = [],
    isLoading: branchesLoading,
    isFetching: branchesFetching,
  } = useBranches();

  const {
    data: userBranchAccess = [],
    isLoading: accessLoading,
    isFetching: accessFetching,
  } = useUserBranchAccess();

  const isOwnerOrAdmin =
    roles.includes("owner") ||
    roles.includes("admin");

  /*
   * Owner/admin:
   * pueden trabajar con cualquier sucursal activa.
   *
   * Manager/cashier/staff:
   * pueden trabajar con:
   *   1. su sucursal principal (profiles.branch_id)
   *   2. cualquier sucursal adicional autorizada
   *      en user_branch_access.
   */
  const branches = useMemo(() => {
    if (isOwnerOrAdmin) {
      return allBranches;
    }

    if (!profile?.branch_id) {
      return allBranches.filter(
        (branch) =>
          userBranchAccess.some(
            (access) =>
              access.branch_id ===
              branch.id,
          ),
      );
    }

    const allowedBranchIds =
      new Set<string>([
        profile.branch_id,
        ...userBranchAccess.map(
          (access) =>
            access.branch_id,
        ),
      ]);

    return allBranches.filter(
      (branch) =>
        allowedBranchIds.has(
          branch.id,
        ),
    );
  }, [
    allBranches,
    isOwnerOrAdmin,
    profile?.branch_id,
    userBranchAccess,
  ]);

  /*
   * Recuperamos la última sucursal usada.
   *
   * Esto evita que al entrar nuevamente al sistema
   * el owner/admin termine automáticamente en la
   * primera sucursal.
   */
  const [
    branchId,
    setBranchIdState,
  ] = useState<string | null>(
    readStoredBranchId,
  );

  /*
   * Identifica el usuario de la selección actual.
   */
  const [
    branchUserId,
    setBranchUserId,
  ] = useState<string | null>(null);

  useEffect(() => {
    const currentUserId =
      user?.id ?? null;

    if (
      currentUserId !==
      branchUserId
    ) {
      setBranchUserId(
        currentUserId,
      );
    }
  }, [
    user?.id,
    branchUserId,
  ]);

  /*
   * Mantiene la sucursal seleccionada válida
   * respecto a las sucursales realmente permitidas.
   */
  useEffect(() => {
    if (
      !user ||
      !profile?.is_active
    ) {
      if (branchId !== null) {
        setBranchIdState(null);
      }

      return;
    }

    /*
     * Mientras se cargan las sucursales o los
     * permisos adicionales no cambiamos la
     * selección actual.
     */
    if (
      branchesLoading ||
      branchesFetching ||
      accessLoading ||
      accessFetching
    ) {
      return;
    }

    if (branches.length === 0) {
      if (branchId !== null) {
        setBranchIdState(null);
        writeStoredBranchId(null);
      }

      return;
    }

    /*
     * 1. Si la selección actual sigue permitida,
     *    la conservamos.
     */
    const currentIsValid =
      branchId !== null &&
      branches.some(
        (branch) =>
          branch.id === branchId,
      );

    if (currentIsValid) {
      writeStoredBranchId(
        branchId,
      );

      return;
    }

    /*
     * 2. Para usuarios limitados por perfil,
     *    su sucursal principal es el primer valor
     *    por defecto.
     *
     *    Las sucursales adicionales siguen disponibles
     *    para selección manual.
     */
    if (
      !isOwnerOrAdmin &&
      profile.branch_id &&
      branches.some(
        (branch) =>
          branch.id ===
          profile.branch_id,
      )
    ) {
      setBranchIdState(
        profile.branch_id,
      );

      writeStoredBranchId(
        profile.branch_id,
      );

      return;
    }

    /*
     * 3. Owner/admin:
     *    si la sucursal guardada sigue existiendo,
     *    la conservamos.
     */
    const stored =
      readStoredBranchId();

    if (
      isOwnerOrAdmin &&
      stored &&
      branches.some(
        (branch) =>
          branch.id === stored,
      )
    ) {
      setBranchIdState(stored);

      return;
    }

    /*
     * 4. Último recurso:
     *    primera sucursal activa permitida.
     */
    const first =
      branches[0]?.id ?? null;

    setBranchIdState(first);
    writeStoredBranchId(first);
  }, [
    user,
    profile?.is_active,
    profile?.branch_id,
    branches,
    branchId,
    isOwnerOrAdmin,
    branchesLoading,
    branchesFetching,
    accessLoading,
    accessFetching,
  ]);

  /*
   * Cambio manual de sucursal.
   *
   * La UI nunca puede seleccionar una sucursal
   * que no esté dentro de "branches".
   */
  const setBranchId = (
    id: string,
  ) => {
    const allowed =
      branches.some(
        (branch) =>
          branch.id === id,
      );

    if (!allowed) {
      return;
    }

    setBranchIdState(id);
    writeStoredBranchId(id);
  };

  /*
   * Si cambia el usuario autenticado, eliminamos
   * cualquier selección que no corresponda a su acceso.
   *
   * Para usuarios normales, la sucursal principal
   * sigue siendo la selección inicial.
   *
   * No forzamos este efecto al cambiar manualmente
   * de sucursal.
   */
  useEffect(() => {
    if (
      !user ||
      !profile?.is_active
    ) {
      writeStoredBranchId(null);
      return;
    }

    if (
      !isOwnerOrAdmin &&
      profile.branch_id
    ) {
      const currentStored =
        readStoredBranchId();

      const userCanUseStoredBranch =
        branches.some(
          (branch) =>
            branch.id ===
            currentStored,
        );

      if (
        !userCanUseStoredBranch
      ) {
        writeStoredBranchId(
          profile.branch_id,
        );
      }
    }
  }, [
    user?.id,
    profile?.is_active,
    profile?.branch_id,
    isOwnerOrAdmin,
    branches,
  ]);

  const value = useMemo(
    () => ({
      branches,
      branchId,
      setBranchId,

      /*
       * Solo bloquear en la carga inicial.
       * Los refetches en segundo plano no deben
       * ocultar Caja.
       */
      loading:
        branchesLoading ||
        accessLoading,
    }),
    [
      branches,
      branchId,
      branchesLoading,
      accessLoading,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useBranch() {
  const ctx =
    useContext(Ctx);

  if (!ctx) {
    throw new Error(
      "useBranch must be used inside BranchProvider",
    );
  }

  return ctx;
}