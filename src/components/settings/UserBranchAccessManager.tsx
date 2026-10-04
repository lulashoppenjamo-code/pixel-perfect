import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/lib/branch";
import { useAuth } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type UserBranchAccessManagerProps = {
  userId: string;
  userName: string;
  primaryBranchId: string | null;
};

type UserBranchAccessRow = {
  user_id: string;
  branch_id: string;
  branch_name: string | null;
  is_primary: boolean;
};

export function UserBranchAccessManager({
  userId,
  userName,
  primaryBranchId,
}: UserBranchAccessManagerProps) {
  const {
    isAdmin,
    can,
  } = useAuth();

  const {
    branches,
  } = useBranch();

  const qc =
    useQueryClient();

  const canManage =
    isAdmin ||
    can("usuarios.manage");

  const [
    selectedBranchId,
    setSelectedBranchId,
  ] = useState("");

  const {
    data: accessRows = [],
    isLoading,
  } = useQuery<UserBranchAccessRow[]>({
    queryKey: [
      "user-branch-access",
      userId,
    ],

    enabled:
      canManage &&
      !!userId,

    queryFn:
      async () => {
        const {
          data,
          error,
        } = await (
          supabase as any
        ).rpc(
          "admin_get_user_branch_access",
          {
            _user_id:
              userId,
          },
        );

        if (error) {
          throw error;
        }

        return (
          data ?? []
        ) as UserBranchAccessRow[];
      },
  });

  useEffect(() => {
    setSelectedBranchId("");
  }, [userId]);

  const addBranch =
    useMutation({
      mutationFn:
        async () => {
          if (!canManage) {
            throw new Error(
              "No tienes permiso para administrar sucursales del usuario.",
            );
          }

          if (!userId) {
            throw new Error(
              "No se indicó el usuario.",
            );
          }

          if (!selectedBranchId) {
            throw new Error(
              "Selecciona una sucursal.",
            );
          }

          if (
            selectedBranchId ===
            primaryBranchId
          ) {
            throw new Error(
              "La sucursal principal ya está asignada.",
            );
          }

          const {
            error,
          } = await (
            supabase as any
          ).rpc(
            "admin_add_user_branch_access",
            {
              _user_id:
                userId,
              _branch_id:
                selectedBranchId,
            },
          );

          if (error) {
            throw error;
          }
        },

      onSuccess:
        async () => {
          toast.success(
            "Sucursal adicional asignada.",
          );

          setSelectedBranchId("");

          await qc.invalidateQueries({
            queryKey: [
              "user-branch-access",
              userId,
            ],
          });

          await qc.invalidateQueries({
            queryKey: [
              "profiles",
            ],
          });
        },

      onError:
        (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudo asignar la sucursal.",
          );
        },
    });

  const removeBranch =
    useMutation({
      mutationFn:
        async (
          branchId: string,
        ) => {
          if (!canManage) {
            throw new Error(
              "No tienes permiso para administrar sucursales del usuario.",
            );
          }

          const {
            error,
          } = await (
            supabase as any
          ).rpc(
            "admin_remove_user_branch_access",
            {
              _user_id:
                userId,
              _branch_id:
                branchId,
            },
          );

          if (error) {
            throw error;
          }
        },

      onSuccess:
        async () => {
          toast.success(
            "Sucursal adicional retirada.",
          );

          await qc.invalidateQueries({
            queryKey: [
              "user-branch-access",
              userId,
            ],
          });

          await qc.invalidateQueries({
            queryKey: [
              "profiles",
            ],
          });
        },

      onError:
        (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudo retirar la sucursal.",
          );
        },
    });

  if (!canManage) {
    return null;
  }

  const accessibleBranchIds =
    new Set(
      accessRows.map(
        (row) =>
          row.branch_id,
      ),
    );

  const availableBranches =
    branches.filter(
      (branch) =>
        branch.id !==
          primaryBranchId &&
        !accessibleBranchIds.has(
          branch.id,
        ),
    );

  return (
    <Card className="mt-4 border-[#e0e0e0] shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[#1a73e8]" />

          <div>
            <CardTitle className="text-base">
              Sucursales de {userName}
            </CardTitle>

            <p className="mt-1 text-sm text-muted-foreground">
              Permite que este usuario pueda trabajar
              en más de una sucursal.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-xl border bg-[#f8f9fa] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-full"
            >
              Principal
            </Badge>

            <span className="text-sm font-semibold">
              {primaryBranchId
                ? branches.find(
                    (branch) =>
                      branch.id ===
                      primaryBranchId,
                  )?.name ??
                  "Sucursal no disponible"
                : "Sin sucursal principal"}
            </span>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Cargando sucursales...
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label>
                Agregar otra sucursal
              </Label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={
                    selectedBranchId
                  }
                  onValueChange={
                    setSelectedBranchId
                  }
                  disabled={
                    addBranch.isPending ||
                    availableBranches.length ===
                      0
                  }
                >
                  <SelectTrigger className="h-11 flex-1">
                    <SelectValue placeholder="Selecciona una sucursal" />
                  </SelectTrigger>

                  <SelectContent>
                    {availableBranches.map(
                      (branch) => (
                        <SelectItem
                          key={
                            branch.id
                          }
                          value={
                            branch.id
                          }
                        >
                          {branch.name}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  className="min-h-11 rounded-xl"
                  disabled={
                    !selectedBranchId ||
                    addBranch.isPending ||
                    availableBranches.length ===
                      0
                  }
                  onClick={() =>
                    addBranch.mutate()
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" />

                  {addBranch.isPending
                    ? "Asignando..."
                    : "Agregar"}
                </Button>
              </div>

              {availableBranches.length ===
                0 && (
                <p className="text-xs text-muted-foreground">
                  No hay otra sucursal disponible
                  para asignar.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>
                Sucursales adicionales
              </Label>

              {accessRows.filter(
                (row) =>
                  !row.is_primary,
              ).length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  No tiene sucursales adicionales.
                </div>
              ) : (
                <div className="grid gap-2">
                  {accessRows
                    .filter(
                      (row) =>
                        !row.is_primary,
                    )
                    .map(
                      (row) => (
                        <div
                          key={
                            row.branch_id
                          }
                          className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {row.branch_name ??
                                branches.find(
                                  (
                                    branch,
                                  ) =>
                                    branch.id ===
                                    row.branch_id,
                                )?.name ??
                                "Sucursal"}
                            </p>

                            <Badge
                              variant="secondary"
                              className="mt-1 rounded-full"
                            >
                              Acceso adicional
                            </Badge>
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                            disabled={
                              removeBranch.isPending
                            }
                            onClick={() =>
                              removeBranch.mutate(
                                row.branch_id,
                              )
                            }
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Quitar
                          </Button>
                        </div>
                      ),
                    )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}