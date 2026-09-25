import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  useQuery,
} from "@tanstack/react-query";

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

const Ctx =
  createContext<BranchState | null>(
    null,
  );

export function useBranches() {
  return useQuery({
    queryKey: ["branches"],

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("branches")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (error) {
        throw error;
      }

      return (data ??
        []) as Branch[];
    },
  });
}

export function BranchProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    profile,
    roles,
  } = useAuth();

  const {
    data: allBranches = [],
    isLoading,
  } = useBranches();

  /*
   * Owner y admin pueden operar cualquier sucursal activa.
   *
   * Manager, cashier y staff quedan limitados a la
   * sucursal asignada a su perfil.
   *
   * Esto coincide con la seguridad del backend y evita
   * que la UI permita seleccionar una sucursal que
   * posteriormente sería rechazada por RLS/RPC.
   */
  const branches = useMemo(() => {
    const isAdmin =
      roles.includes("owner") ||
      roles.includes("admin");

    if (isAdmin) {
      return allBranches;
    }

    if (!profile?.branch_id) {
      return [];
    }

    return allBranches.filter(
      (branch) =>
        branch.id ===
        profile.branch_id,
    );
  }, [
    allBranches,
    profile?.branch_id,
    roles,
  ]);

  const [
    branchId,
    setBranchIdState,
  ] = useState<string | null>(
    null,
  );

  /*
   * Cambio controlado de sucursal.
   *
   * Nunca permitimos establecer desde la UI
   * una sucursal que el usuario no tenga disponible.
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
  };

  /*
   * Selección inicial:
   *
   * 1. Conserva la sucursal actual si todavía es válida.
   * 2. Para usuarios con sucursal asignada, usa esa.
   * 3. Para owner/admin sin asignación, usa la primera.
   */
  useEffect(() => {
    if (branches.length === 0) {
      if (branchId !== null) {
        setBranchIdState(null);
      }

      return;
    }

    const currentIsValid =
      branchId !== null &&
      branches.some(
        (branch) =>
          branch.id === branchId,
      );

    if (currentIsValid) {
      return;
    }

    if (
      profile?.branch_id &&
      branches.some(
        (branch) =>
          branch.id ===
          profile.branch_id,
      )
    ) {
      setBranchIdState(
        profile.branch_id,
      );

      return;
    }

    setBranchIdState(
      branches[0]!.id,
    );
  }, [
    branches,
    branchId,
    profile?.branch_id,
  ]);

  const value = useMemo(
    () => ({
      branches,
      branchId,
      setBranchId,
      loading: isLoading,
    }),
    [
      branches,
      branchId,
      isLoading,
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