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
  const { profile, roles, user } = useAuth();

  const {
    data: allBranches = [],
    isLoading,
    isFetching,
  } = useBranches();

  const isOwnerOrAdmin =
    roles.includes("owner") ||
    roles.includes("admin");

  /*
   * Owner/admin:
   * pueden trabajar con cualquier sucursal activa.
   *
   * Manager/cashier/staff:
   * solamente con la sucursal asignada al perfil.
   */
  const branches = useMemo(() => {
    if (isOwnerOrAdmin) {
      return allBranches;
    }

    if (!profile?.branch_id) {
      return [];
    }

    return allBranches.filter(
      (branch) =>
        branch.id === profile.branch_id,
    );
  }, [
    allBranches,
    isOwnerOrAdmin,
    profile?.branch_id,
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
   * Cuando cambia de usuario, no debemos conservar
   * la sucursal del usuario anterior.
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

      /*
       * No eliminamos todavía el valor almacenado.
       * Primero verificamos abajo si sigue siendo válido.
       */
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
    if (!user || !profile?.is_active) {
      if (branchId !== null) {
        setBranchIdState(null);
      }

      return;
    }

    /*
     * Mientras se están cargando las sucursales
     * no cambiamos la selección actual.
     */
    if (isLoading || isFetching) {
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
      writeStoredBranchId(branchId);
      return;
    }

    /*
     * 2. Para usuarios limitados por perfil,
     *    siempre debe ganar branch_id del perfil.
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
     *    si la sucursal guardada ya no existe,
     *    usamos la primera disponible.
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
     *    primera sucursal activa.
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
    isLoading,
    isFetching,
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
   */
  useEffect(() => {
    if (!user || !profile?.is_active) {
      writeStoredBranchId(null);
      return;
    }

    if (
      !isOwnerOrAdmin &&
      profile.branch_id
    ) {
      writeStoredBranchId(
        profile.branch_id,
      );
    }
  }, [
    user?.id,
    profile?.is_active,
    profile?.branch_id,
    isOwnerOrAdmin,
  ]);

  const value = useMemo(
    () => ({
      branches,
      branchId,
      setBranchId,
      loading:
        isLoading ||
        isFetching,
    }),
    [
      branches,
      branchId,
      isLoading,
      isFetching,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(Ctx);

  if (!ctx) {
    throw new Error(
      "useBranch must be used inside BranchProvider",
    );
  }

  return ctx;
}