import { useMemo, useState } from "react";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  useAuth,
  type AppRole,
} from "@/lib/auth";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Checkbox } from "@/components/ui/checkbox";

type PermissionCatalogRow = {
  key: string;
  module: string;
  action: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type RolePermissionRow = {
  role: AppRole;
  permission_key: string;
};

const ROLES: AppRole[] = [
  "owner",
  "admin",
  "manager",
  "cashier",
  "staff",
];

const MODULE_LABELS: Record<
  string,
  string
> = {
  ventas: "Ventas",
  productos: "Productos",
  inventario: "Inventario",
  clientes: "Clientes",
  compras: "Compras",
  caja: "Caja",
  gastos: "Gastos",
  devoluciones: "Devoluciones",
  pedidos: "Pedidos",
  reposicion: "Reposición",
  reportes: "Reportes",
  ceo: "CEO",
  ajustes: "Ajustes",
  usuarios: "Personal",
};

const ROLE_LABELS: Record<
  AppRole,
  string
> = {
  owner: "Owner",
  admin: "Administrador",
  manager: "Gerente",
  cashier: "Cajero",
  staff: "Personal",
};

export function RolePermissionsSettings() {
  const {
    isAdmin,
  } = useAuth();

  const qc = useQueryClient();

  const [
    selectedRole,
    setSelectedRole,
  ] = useState<AppRole>("manager");

  const {
    data: catalog = [],
    isLoading: catalogLoading,
  } = useQuery<
    PermissionCatalogRow[]
  >({
    queryKey: [
      "permission-catalog",
    ],

    enabled: isAdmin,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("permission_catalog")
        .select(
          "key, module, action, label, description, sort_order, is_active",
        )
        .eq(
          "is_active",
          true,
        )
        .order(
          "sort_order",
          {
            ascending: true,
          },
        );

      if (error) {
        throw error;
      }

      return (
        data ?? []
      ) as PermissionCatalogRow[];
    },
  });

  const {
    data: rolePermissions = [],
    isLoading: permissionsLoading,
  } = useQuery<
    RolePermissionRow[]
  >({
    queryKey: [
      "role-permissions",
      selectedRole,
    ],

    enabled:
      isAdmin &&
      !!selectedRole,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("role_permissions")
        .select(
          "role, permission_key",
        )
        .eq(
          "role",
          selectedRole,
        );

      if (error) {
        throw error;
      }

      return (
        data ?? []
      ) as RolePermissionRow[];
    },
  });

  const permissionSet =
    useMemo(
      () =>
        new Set(
          rolePermissions.map(
            (item) =>
              item.permission_key,
          ),
        ),
      [
        rolePermissions,
      ],
    );

  const groupedPermissions =
    useMemo(() => {
      const groups =
        new Map<
          string,
          PermissionCatalogRow[]
        >();

      for (const item of catalog) {
        const current =
          groups.get(
            item.module,
          ) ?? [];

        current.push(item);

        groups.set(
          item.module,
          current,
        );
      }

      return Array.from(
        groups.entries(),
      );
    }, [catalog]);

  const updatePermission =
    useMutation({
      mutationFn:
        async ({
          permissionKey,
          enabled,
        }: {
          permissionKey: string;
          enabled: boolean;
        }) => {
          /*
           * Owner solamente puede ser modificado
           * por otro owner. La misma regla se vuelve
           * a validar en Supabase.
           */
          if (
            selectedRole ===
              "owner" &&
            !await isCurrentUserOwner()
          ) {
            throw new Error(
              "Solo un owner puede modificar los permisos del owner.",
            );
          }

          const {
            error,
          } = await (
            supabase as any
          ).rpc(
            "admin_set_role_permission",
            {
              _role:
                selectedRole,
              _permission_key:
                permissionKey,
              _enabled:
                enabled,
            },
          );

          if (error) {
            throw error;
          }
        },

      onMutate: async ({
        permissionKey,
        enabled,
      }) => {
        await qc.cancelQueries({
          queryKey: [
            "role-permissions",
            selectedRole,
          ],
        });

        const previous =
          qc.getQueryData<
            RolePermissionRow[]
          >([
            "role-permissions",
            selectedRole,
          ]);

        const current =
          previous ?? [];

        const next =
          enabled
            ? [
                ...current.filter(
                  (item) =>
                    item.permission_key !==
                    permissionKey,
                ),
                {
                  role:
                    selectedRole,
                  permission_key:
                    permissionKey,
                },
              ]
            : current.filter(
                (item) =>
                  item.permission_key !==
                  permissionKey,
              );

        qc.setQueryData(
          [
            "role-permissions",
            selectedRole,
          ],
          next,
        );

        return {
          previous,
        };
      },

      onError: (
        error,
        _variables,
        context,
      ) => {
        if (context?.previous) {
          qc.setQueryData(
            [
              "role-permissions",
              selectedRole,
            ],
            context.previous,
          );
        }

        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el permiso.",
        );
      },

      onSuccess: () => {
        toast.success(
          "Permiso actualizado.",
        );
      },

      onSettled: () => {
        void qc.invalidateQueries({
          queryKey: [
            "role-permissions",
            selectedRole,
          ],
        });
      },
    });

  async function isCurrentUserOwner() {
    const {
      data,
      error,
    } = await supabase.rpc(
      "has_role",
      {
        _user_id:
          (
            await supabase.auth.getUser()
          ).data.user?.id ?? "",
        _role: "owner",
      },
    );

    if (error) {
      return false;
    }

    return data === true;
  }

  const loading =
    catalogLoading ||
    permissionsLoading;

  const enabledCount =
    permissionSet.size;

  const totalCount =
    catalog.length;

  const canEditSelectedRole =
    selectedRole !== "owner" ||
    true;

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />

          <p className="font-semibold">
            Acceso restringido
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            Solo owner o administrador pueden
            administrar permisos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-[#e0e0e0] shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#1a73e8]" />

                <CardTitle className="text-base">
                  Permisos por rol
                </CardTitle>
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                Define qué módulos puede ver cada
                rol y qué acciones puede realizar.
              </p>
            </div>

            <div className="w-full lg:w-64">
              <Select
                value={selectedRole}
                onValueChange={(
                  value,
                ) =>
                  setSelectedRole(
                    value as AppRole,
                  )
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {ROLES.map(
                    (role) => (
                      <SelectItem
                        key={role}
                        value={role}
                      >
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {ROLE_LABELS[selectedRole]}
            </Badge>

            <Badge variant="secondary">
              {enabledCount} de{" "}
              {totalCount} permisos
            </Badge>

            {selectedRole ===
              "owner" && (
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                Owner protegido
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="flex min-h-40 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando permisos...
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groupedPermissions.map(
            ([
              module,
              permissions,
            ]) => {
              const moduleEnabled =
                permissions.filter(
                  (permission) =>
                    permissionSet.has(
                      permission.key,
                    ),
                ).length;

              return (
                <Card
                  key={module}
                  className="overflow-hidden border-[#e0e0e0] shadow-sm"
                >
                  <CardHeader className="border-b bg-[#fafafa] py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm">
                          {MODULE_LABELS[
                            module
                          ] ??
                            module}
                        </CardTitle>

                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {moduleEnabled} de{" "}
                          {permissions.length}{" "}
                          permisos activos
                        </p>
                      </div>

                      {moduleEnabled ===
                        permissions.length && (
                        <Badge className="gap-1 bg-[#e8f5e9] text-[#2e7d32] hover:bg-[#e8f5e9]">
                          <Check className="h-3 w-3" />
                          Completo
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="p-0">
                    <div className="divide-y">
                      {permissions.map(
                        (
                          permission,
                        ) => {
                          const checked =
                            permissionSet.has(
                              permission.key,
                            );

                          const protectedOwner =
                            selectedRole ===
                              "owner" &&
                            !isCurrentUserOwner();

                          return (
                            <label
                              key={
                                permission.key
                              }
                              className={[
                                "flex cursor-pointer items-start gap-3 p-4 transition-colors",
                                "hover:bg-[#fafafa]",
                                protectedOwner
                                  ? "cursor-not-allowed opacity-70"
                                  : "",
                              ].join(
                                " ",
                              )}
                            >
                              <Checkbox
                                checked={
                                  checked
                                }
                                disabled={
                                  protectedOwner ||
                                  updatePermission.isPending
                                }
                                onCheckedChange={(
                                  value,
                                ) =>
                                  updatePermission.mutate(
                                    {
                                      permissionKey:
                                        permission.key,
                                      enabled:
                                        value ===
                                        true,
                                    },
                                  )
                                }
                                className="mt-0.5"
                              />

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-sm font-semibold">
                                    {
                                      permission.label
                                    }
                                  </p>

                                  <code className="w-fit rounded bg-[#f5f5f5] px-1.5 py-0.5 text-[10px] text-[#757575]">
                                    {
                                      permission.key
                                    }
                                  </code>
                                </div>

                                {permission.description && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {
                                      permission.description
                                    }
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        },
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            },
          )}
        </div>
      )}

      <Card className="border-blue-100 bg-blue-50/50">
        <CardContent className="p-4">
          <p className="text-xs leading-5 text-blue-900">
            <strong>Importante:</strong> estos permisos
            controlan la configuración del rol. La
            protección definitiva de operaciones sensibles
            también debe mantenerse en Supabase mediante
            RLS y funciones seguras. No se sustituye la
            seguridad del servidor por ocultar botones.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}