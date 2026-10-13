
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
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
  "admin",
  "manager",
  "cashier",
  "staff",
];

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Propietario (máster)",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  staff: "Ayudante general",
};

const MODULE_LABELS: Record<string, string> = {
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
  usuarios: "Personal y usuarios",
};

export function RolePermissionsSettings() {
  const { roles, loading: authLoading } = useAuth();
  const isOwner = roles.includes("owner");
  const qc = useQueryClient();

  const [selectedRole, setSelectedRole] =
    useState<AppRole>("manager");

  const catalogQuery = useQuery<PermissionCatalogRow[]>({
    queryKey: ["permission-catalog"],
    enabled: isOwner && !authLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_catalog")
        .select(
          "key, module, action, label, description, sort_order, is_active",
        )
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PermissionCatalogRow[];
    },
  });

  const permissionsQuery = useQuery<RolePermissionRow[]>({
    queryKey: ["role-permissions", selectedRole],
    enabled: isOwner && !authLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("role, permission_key")
        .eq("role", selectedRole);

      if (error) throw error;
      return (data ?? []) as RolePermissionRow[];
    },
  });

  const catalog = catalogQuery.data ?? [];
  const rolePermissions = permissionsQuery.data ?? [];

  const permissionSet = useMemo(
    () => new Set(rolePermissions.map((p) => p.permission_key)),
    [rolePermissions],
  );

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionCatalogRow[]>();

    for (const permission of catalog) {
      const items = groups.get(permission.module) ?? [];
      items.push(permission);
      groups.set(permission.module, items);
    }

    return Array.from(groups.entries());
  }, [catalog]);

  const updatePermission = useMutation({
    mutationFn: async ({
      permissionKey,
      enabled,
    }: {
      permissionKey: string;
      enabled: boolean;
    }) => {
      if (!isOwner) {
        throw new Error(
          "Solo la sesión del dueño puede configurar permisos.",
        );
      }

      if (selectedRole === "owner") {
        throw new Error(
          "El rol máster está protegido y no se puede modificar aquí.",
        );
      }

      const { error } = await (supabase as any).rpc(
        "admin_set_role_permission",
        {
          _role: selectedRole,
          _permission_key: permissionKey,
          _enabled: enabled,
        },
      );

      if (error) throw error;
    },

    onMutate: async ({ permissionKey, enabled }) => {
      const queryKey = ["role-permissions", selectedRole];

      await qc.cancelQueries({ queryKey });

      const previous =
        qc.getQueryData<RolePermissionRow[]>(queryKey);

      const current = previous ?? [];

      const next = enabled
        ? [
            ...current.filter(
              (p) => p.permission_key !== permissionKey,
            ),
            {
              role: selectedRole,
              permission_key: permissionKey,
            },
          ]
        : current.filter(
            (p) => p.permission_key !== permissionKey,
          );

      qc.setQueryData(queryKey, next);
      return { previous, queryKey };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) {
        qc.setQueryData(context.queryKey, context.previous);
      }

      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el permiso.",
      );
    },

    onSuccess: () => {
      toast.success("Permiso actualizado.");
    },

    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: ["role-permissions", selectedRole],
      });
      void qc.invalidateQueries({
        queryKey: ["my-permissions"],
      });
    },
  });

  if (authLoading) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2">Verificando sesión…</span>
        </CardContent>
      </Card>
    );
  }

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <p className="font-semibold">Acceso restringido</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Solo la sesión máster del dueño puede configurar los permisos por rol.
          </p>
        </CardContent>
      </Card>
    );
  }

  const loading =
    catalogQuery.isLoading || permissionsQuery.isLoading;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">
              Permisos por rol
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Marca o desmarca las casillas para decidir qué módulos
            puede consultar cada rol y qué operaciones puede realizar.
            Los cambios afectan al rol seleccionado, no a tu sesión máster.
          </p>
        </CardHeader>

        <CardContent className="space-y-3">
          <label className="text-sm font-medium">
            Rol que quieres configurar
          </label>
          <Select
            value={selectedRole}
            onValueChange={(value) =>
              setSelectedRole(value as AppRole)
            }
          >
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {ROLE_LABELS[selectedRole]}
            </Badge>
            <Badge variant="secondary">
              {permissionSet.size} permisos activos
            </Badge>
            <Badge variant="outline">
              {catalog.length} permisos disponibles
            </Badge>
          </div>
        </CardContent>
      </Card>

      {catalogQuery.isError || permissionsQuery.isError ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="font-medium">
              No se pudieron cargar los permisos.
            </p>
            <p className="text-sm text-muted-foreground">
              Verifica que existan las tablas permission_catalog y
              role_permissions y que la sesión tenga autorización de lectura.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void catalogQuery.refetch();
                void permissionsQuery.refetch();
              }}
            >
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="flex min-h-36 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2">Cargando permisos…</span>
          </CardContent>
        </Card>
      ) : catalog.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            El catálogo no contiene permisos activos.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groupedPermissions.map(([module, permissions]) => {
            const enabledCount = permissions.filter((p) =>
              permissionSet.has(p.key),
            ).length;

            const allEnabled =
              enabledCount === permissions.length;

            return (
              <Card key={module} className="overflow-hidden">
                <CardHeader className="border-b bg-muted/30 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">
                        {MODULE_LABELS[module] ?? module}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {enabledCount} de {permissions.length} permisos activos
                      </p>
                    </div>
                    {allEnabled && (
                      <Badge variant="secondary">
                        <Check className="mr-1 h-3 w-3" />
                        Completo
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updatePermission.isPending || allEnabled}
                      onClick={() => {
                        for (const permission of permissions) {
                          if (!permissionSet.has(permission.key)) {
                            updatePermission.mutate({
                              permissionKey: permission.key,
                              enabled: true,
                            });
                          }
                        }
                      }}
                    >
                      Seleccionar módulo
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        updatePermission.isPending || enabledCount === 0
                      }
                      onClick={() => {
                        for (const permission of permissions) {
                          if (permissionSet.has(permission.key)) {
                            updatePermission.mutate({
                              permissionKey: permission.key,
                              enabled: false,
                            });
                          }
                        }
                      }}
                    >
                      Desmarcar módulo
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="divide-y p-0">
                  {permissions.map((permission) => {
                    const checked = permissionSet.has(permission.key);

                    return (
                      <label
                        key={permission.key}
                        className="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/30"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={updatePermission.isPending}
                          onCheckedChange={(value) => {
                            updatePermission.mutate({
                              permissionKey: permission.key,
                              enabled: value === true,
                            });
                          }}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">
                            {permission.label}
                          </p>
                          {permission.description && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {permission.description}
                            </p>
                          )}
                          <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px]">
                            {permission.key}
                          </code>
                        </div>
                      </label>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="py-4 text-xs leading-5 text-muted-foreground">
          <strong>Protección:</strong> esta pantalla no permite modificar el
          rol dueño. La base de datos debe validar también que únicamente un
          owner pueda cambiar los permisos de otros roles. Ocultar una opción
          no sustituye las políticas RLS ni las validaciones del servidor.
        </CardContent>
      </Card>
    </div>
  );
}
