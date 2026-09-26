import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type Branch = { id: string; name: string; address: string | null; phone: string | null; is_active: boolean };

type BranchState = {
  branches: Branch[];
  branchId: string | null;
  setBranchId: (id: string) => void;
  loading: boolean;
};

const Ctx = createContext<BranchState | null>(null);

export function useBranches() {
  return useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { data: branches = [], isLoading } = useBranches();
  const [branchId, setBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (branchId) return;
    if (profile?.branch_id) setBranchId(profile.branch_id);
    else if (branches.length) setBranchId(branches[0]!.id);
  }, [branches, profile, branchId]);

  const value = useMemo(
    () => ({ branches, branchId, setBranchId, loading: isLoading }),
    [branches, branchId, isLoading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranch() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBranch must be used inside BranchProvider");
  return ctx;
}
