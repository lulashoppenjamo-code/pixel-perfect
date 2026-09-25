import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequireNavAccess } from "@/components/RequireNavAccess";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Settings,
  UserCheck,
  UserX,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { useBranch } from "@/lib/branch";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

export const Route = createFileRoute(
  "/_shell/ajustes",
)({
  head: () => ({
    meta: [
      {
        title: "Ajustes — Lula Shop OS",
      },
      {
        name: "description",
        content:
          "Administra sucursales, usuarios, roles y configuración general del negocio.",
      },
      {
        property: "og:title",
        content: "Ajustes — Lula Shop OS",
      },
      {
        property: "og:description",
        content:
          "Administra sucursales, usuarios, roles y configuración general del negocio.",
      },
    ],
  }),

  component: () => (
    <RequireNavAccess navKey="ajustes">
      <AjustesPage />
    </RequireNavAccess>
  ),
});

const ROLES: AppRole[] = [
  "owner",
  "admin",
  "manager",
  "cashier",
  "staff",
];

type ProfileRow = {
  id: string;
  full_name: string | null;
  branch_id: string | null;
  is_active: boolean;
  roles: AppRole[];
};

type SettingRow = {
  id: string;
  branch_id: string | null;
  key: string;
  value: unknown;
};

function AjustesPage() {
  const {
    user,
    isAdmin,
    isManager,
  } = useAuth();

  const {
    branches,
    branchId,
  } = useBranch();

  const qc = useQueryClient();

  const [branch, setBranch] =
    useState({
      name: "",
      address: "",
      phone: "",
    });

  const [setting, setSetting] =
    useState({
      key: "",
      value: "",
    });

  const {
    data: profiles = [],
    isLoading: profilesLoading,
  } = useQuery<ProfileRow[]>({
    queryKey: ["profiles"],
    enabled: isAdmin,

    queryFn: async () => {
      const [
        profilesResult,
        rolesResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, full_name, branch_id, is_active",
          )
          .order("full_name"),

        supabase
          .from("user_roles")
          .select(
            "user_id, role",
          ),
      ]);

      if (profilesResult.error) {
        throw profilesResult.error;
      }

      if (rolesResult.error) {
        throw rolesResult.error;
      }

      const roleRows =
        rolesResult.data ?? [];

      return (
        profilesResult.data ?? []
      ).map((profile) => ({
        id: profile.id,
        full_name:
          profile.full_name,
        branch_id:
          profile.branch_id,
        is_active:
          profile.is_active,
        roles: roleRows
          .filter(
            (row) =>
              row.user_id ===
              profile.id,
          )
          .map(
            (row) =>
              row.role as AppRole,
          ),
      }));
    },
  });

  const {
    data: settings = [],
  } = useQuery<SettingRow[]>({
    queryKey: [
      "settings",
      branchId,
    ],

    enabled:
      !!branchId &&
      isManager,

    queryFn: async () => {
      const {
        data,
        error,
      } = await supabase
        .from("settings")
        .select(
          "id, branch_id, key, value",
        )
        .order("key");

      if (error) {
        throw error;
      }

      return (
        data ?? []
      ) as SettingRow[];
    },
  });

  const createBranch =
    useMutation({
      mutationFn:
        async () => {
          const name =
            branch.name.trim();

          if (!name) {
            throw new Error(
              "El nombre de la sucursal es obligatorio.",
            );
          }

          const {
            error,
          } = await supabase
            .from("branches")
            .insert({
              name,
              address:
                branch.address.trim() ||
                null,
              phone:
                branch.phone.trim() ||
                null,
            });

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Sucursal creada",
        );

        setBranch({
          name: "",
          address: "",
          phone: "",
        });

        void qc.invalidateQueries({
          queryKey: [
            "branches",
          ],
        });

        void qc.invalidateQueries({
          queryKey: [
            "profiles",
          ],
        });
      },

      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo crear la sucursal.",
        ),
    });

  /*
   * Administración segura de usuarios.
   *
   * IMPORTANTE:
   * No hacemos UPDATE directo sobre profiles
   * ni DELETE/INSERT directo sobre user_roles.
   *
   * Todo pasa por admin_set_user_access().
   */
  const setUserAccess =
    useMutation({
      mutationFn:
        async ({
          userId,
          role,
          bid,
          active,
        }: {
          userId: string;
          role: AppRole;
          bid: string | null;
          active: boolean;
        }) => {
          if (!isAdmin) {
            throw new Error(
              "No tienes permiso para administrar usuarios.",
            );
          }

          /*
           * Se utiliza any únicamente para mantener
           * compatibilidad si types.ts todavía no
           * contiene la nueva función RPC.
           *
           * La seguridad real está en Supabase:
           * admin_set_user_access().
           */
          const {
            error,
          } = await (
            supabase as any
          ).rpc(
            "admin_set_user_access",
            {
              _user_id:
                userId,
              _role:
                role,
              _branch_id:
                bid,
              _is_active:
                active,
            },
          );

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Acceso del usuario actualizado.",
        );

        void qc.invalidateQueries({
          queryKey: [
            "profiles",
          ],
        });
      },

      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el usuario.",
        ),
    });

  /*
   * Guarda una configuración únicamente
   * para la sucursal activa.
   *
   * No usamos upsert(..., { onConflict:
   * "branch_id,key" }) porque la tabla utiliza
   * un índice único basado en expresión para
   * soportar correctamente branch_id NULL.
   */
  const saveSetting =
    useMutation({
      mutationFn:
        async () => {
          if (!isManager) {
            throw new Error(
              "No tienes permiso para modificar configuración.",
            );
          }

          if (!branchId) {
            throw new Error(
              "No hay una sucursal activa.",
            );
          }

          const key =
            setting.key.trim();

          if (!key) {
            throw new Error(
              "La clave es obligatoria.",
            );
          }

          let parsed: unknown;

          try {
            parsed =
              JSON.parse(
                setting.value,
              );
          } catch {
            parsed =
              setting.value;
          }

          /*
           * Primero buscamos si ya existe
           * configuración para esta sucursal.
           */
          const {
            data: existing,
            error:
              findError,
          } = await supabase
            .from("settings")
            .select("id")
            .eq(
              "branch_id",
              branchId,
            )
            .eq(
              "key",
              key,
            )
            .maybeSingle();

          if (findError) {
            throw findError;
          }

          if (existing?.id) {
            const {
              error,
            } = await supabase
              .from("settings")
              .update({
                value:
                  parsed as never,
              })
              .eq(
                "id",
                existing.id,
              );

            if (error) {
              throw error;
            }

            return;
          }

          const {
            error,
          } = await supabase
            .from("settings")
            .insert({
              branch_id:
                branchId,
              key,
              value:
                parsed as never,
            });

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Configuración guardada.",
        );

        setSetting({
          key: "",
          value: "",
        });

        void qc.invalidateQueries({
          queryKey: [
            "settings",
          ],
        });

        void qc.invalidateQueries({
          queryKey: [
            "settings-pos",
          ],
        });
      },

      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo guardar la configuración.",
        ),
    });

  const isCurrentUser =
    (id: string) =>
      id === user?.id;

  const isUserOwner =
    (profile: ProfileRow) =>
      profile.roles.includes(
        "owner",
      );

  const getUserRole =
    (profile: ProfileRow) =>
      profile.roles[0] ??
      "staff";

  const getBranchName =
    (id: string | null) => {
      if (!id) {
        return "Sin asignar";
      }

      return (
        branches.find(
          (item) =>
            item.id === id,
        )?.name ??
        "Sucursal no disponible"
      );
    };

  return (
    <PageShell>
      <PageHeader
        icon={Settings}
        title="Ajustes"
        description="Sucursales, usuarios, roles y configuración general del negocio."
      />

      <Tabs
        defaultValue="sucursales"
        className="space-y-4"
      >
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="sucursales">
            Sucursales
          </TabsTrigger>

          {isAdmin && (
            <TabsTrigger value="usuarios">
              Usuarios y roles
            </TabsTrigger>
          )}

          {isManager && (
            <TabsTrigger value="general">
              General
            </TabsTrigger>
          )}
        </TabsList>

        {/* ================================================== */}
        {/* SUCURSALES */}
        {/* ================================================== */}

        <TabsContent
          value="sucursales"
          className="grid gap-4 lg:grid-cols-[1fr_340px]"
        >
          <Card>
            <CardHeader>
              <CardTitle>
                Sucursales activas
              </CardTitle>
            </CardHeader>

            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      Nombre
                    </TableHead>

                    <TableHead>
                      Dirección
                    </TableHead>

                    <TableHead>
                      Teléfono
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {branches.map(
                    (item) => (
                      <TableRow
                        key={item.id}
                      >
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>

                        <TableCell>
                          {item.address ??
                            "—"}
                        </TableCell>

                        <TableCell>
                          {item.phone ??
                            "—"}
                        </TableCell>
                      </TableRow>
                    ),
                  )}

                  {!branches.length && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No hay sucursales activas
                        disponibles para tu usuario.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>
                Nueva sucursal
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {!isAdmin && (
                <p className="text-sm text-muted-foreground">
                  Solo owner o admin pueden
                  crear sucursales.
                </p>
              )}

              <div className="space-y-2">
                <Label>
                  Nombre
                </Label>

                <Input
                  value={
                    branch.name
                  }
                  onChange={(
                    event,
                  ) =>
                    setBranch({
                      ...branch,
                      name:
                        event.target
                          .value,
                    })
                  }
                  placeholder="Sucursal Centro"
                  disabled={!isAdmin}
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Dirección
                </Label>

                <Input
                  value={
                    branch.address
                  }
                  onChange={(
                    event,
                  ) =>
                    setBranch({
                      ...branch,
                      address:
                        event.target
                          .value,
                    })
                  }
                  placeholder="Dirección"
                  disabled={!isAdmin}
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Teléfono
                </Label>

                <Input
                  value={
                    branch.phone
                  }
                  onChange={(
                    event,
                  ) =>
                    setBranch({
                      ...branch,
                      phone:
                        event.target
                          .value,
                    })
                  }
                  placeholder="Teléfono"
                  disabled={!isAdmin}
                />
              </div>

              <Button
                className="w-full"
                disabled={
                  !isAdmin ||
                  !branch.name.trim() ||
                  createBranch.isPending
                }
                onClick={() =>
                  createBranch.mutate()
                }
              >
                {createBranch.isPending
                  ? "Creando..."
                  : "Crear sucursal"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================== */}
        {/* USUARIOS */}
        {/* ================================================== */}

        {isAdmin && (
          <TabsContent value="usuarios">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>
                      Usuarios y permisos
                    </CardTitle>

                    <p className="mt-1 text-sm text-muted-foreground">
                      El acceso se controla desde
                      Supabase. Los cambios de rol,
                      sucursal y activación se realizan
                      de forma atómica.
                    </p>
                  </div>

                  <Badge variant="outline">
                    {profiles.length} usuario
                    {profiles.length === 1
                      ? ""
                      : "s"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="overflow-x-auto">
                {profilesLoading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Cargando usuarios...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          Usuario
                        </TableHead>

                        <TableHead>
                          Rol
                        </TableHead>

                        <TableHead>
                          Sucursal
                        </TableHead>

                        <TableHead>
                          Estado
                        </TableHead>

                        <TableHead className="text-right">
                          Acciones
                        </TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {profiles.map(
                        (profile) => {
                          const owner =
                            isUserOwner(
                              profile,
                            );

                          const current =
                            isCurrentUser(
                              profile.id,
                            );

                          const role =
                            getUserRole(
                              profile,
                            );

                          const canModify =
                            !current;

                          return (
                            <TableRow
                              key={
                                profile.id
                              }
                            >
                              <TableCell>
                                <div className="min-w-[180px]">
                                  <p className="font-semibold">
                                    {profile.full_name?.trim() ||
                                      "Sin nombre"}
                                  </p>

                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {current
                                      ? "Sesión actual"
                                      : profile.id.slice(
                                          0,
                                          8,
                                        ) +
                                        "..."}
                                  </p>
                                </div>
                              </TableCell>

                              <TableCell>
                                <Select
                                  value={
                                    role
                                  }
                                  disabled={
                                    !canModify ||
                                    setUserAccess.isPending
                                  }
                                  onValueChange={(
                                    value,
                                  ) =>
                                    setUserAccess.mutate(
                                      {
                                        userId:
                                          profile.id,
                                        role:
                                          value as AppRole,
                                        bid:
                                          profile.branch_id,
                                        active:
                                          profile.is_active,
                                      },
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-36">
                                    <SelectValue />
                                  </SelectTrigger>

                                  <SelectContent>
                                    {ROLES.map(
                                      (
                                        item,
                                      ) => (
                                        <SelectItem
                                          key={
                                            item
                                          }
                                          value={
                                            item
                                          }
                                        >
                                          {item}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>

                                {owner && (
                                  <p className="mt-1 text-[11px] font-medium text-amber-600">
                                    Owner protegido
                                  </p>
                                )}
                              </TableCell>

                              <TableCell>
                                <Select
                                  value={
                                    profile.branch_id ??
                                    "none"
                                  }
                                  disabled={
                                    !canModify ||
                                    setUserAccess.isPending
                                  }
                                  onValueChange={(
                                    value,
                                  ) =>
                                    setUserAccess.mutate(
                                      {
                                        userId:
                                          profile.id,
                                        role,
                                        bid:
                                          value ===
                                          "none"
                                            ? null
                                            : value,
                                        active:
                                          profile.is_active,
                                      },
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-48">
                                    <SelectValue placeholder="Sin asignar" />
                                  </SelectTrigger>

                                  <SelectContent>
                                    <SelectItem value="none">
                                      Sin asignar
                                    </SelectItem>

                                    {branches.map(
                                      (
                                        item,
                                      ) => (
                                        <SelectItem
                                          key={
                                            item.id
                                          }
                                          value={
                                            item.id
                                          }
                                        >
                                          {
                                            item.name
                                          }
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>

                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  {getBranchName(
                                    profile.branch_id,
                                  )}
                                </p>
                              </TableCell>

                              <TableCell>
                                {profile.is_active ? (
                                  <Badge className="gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Activo
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1"
                                  >
                                    <UserX className="h-3 w-3" />
                                    Pendiente
                                  </Badge>
                                )}
                              </TableCell>

                              <TableCell className="text-right">
                                {current ? (
                                  <Badge
                                    variant="outline"
                                  >
                                    Sesión actual
                                  </Badge>
                                ) : owner ? (
                                  <Badge
                                    variant="outline"
                                  >
                                    Owner
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant={
                                      profile.is_active
                                        ? "outline"
                                        : "default"
                                    }
                                    disabled={
                                      setUserAccess.isPending
                                    }
                                    onClick={() =>
                                      setUserAccess.mutate(
                                        {
                                          userId:
                                            profile.id,
                                          role,
                                          bid:
                                            profile.branch_id,
                                          active:
                                            !profile.is_active,
                                        },
                                      )
                                    }
                                  >
                                    {profile.is_active ? (
                                      <>
                                        <UserX className="mr-1.5 h-4 w-4" />
                                        Desactivar
                                      </>
                                    ) : (
                                      <>
                                        <UserCheck className="mr-1.5 h-4 w-4" />
                                        Activar
                                      </>
                                    )}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        },
                      )}

                      {!profiles.length && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            No hay perfiles para mostrar.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ================================================== */}
        {/* GENERAL */}
        {/* ================================================== */}

        {isManager && (
          <TabsContent
            value="general"
            className="grid gap-4 lg:grid-cols-[1fr_340px]"
          >
            <Card>
              <CardHeader>
                <CardTitle>
                  Configuración de la sucursal
                </CardTitle>

                <p className="text-sm text-muted-foreground">
                  Estas configuraciones aplican a la
                  sucursal activa.
                </p>
              </CardHeader>

              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        Clave
                      </TableHead>

                      <TableHead>
                        Valor
                      </TableHead>

                      <TableHead>
                        Alcance
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {settings.map(
                      (item) => (
                        <TableRow
                          key={
                            item.id
                          }
                        >
                          <TableCell className="font-medium">
                            {item.key}
                          </TableCell>

                          <TableCell className="max-w-[320px] truncate">
                            {JSON.stringify(
                              item.value,
                            )}
                          </TableCell>

                          <TableCell>
                            {item.branch_id
                              ? getBranchName(
                                  item.branch_id,
                                )
                              : "Global"}
                          </TableCell>
                        </TableRow>
                      ),
                    )}

                    {!settings.length && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No hay configuraciones
                          guardadas para esta
                          sucursal.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>
                  Nuevo ajuste
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>
                    Clave
                  </Label>

                  <Input
                    value={
                      setting.key
                    }
                    onChange={(
                      event,
                    ) =>
                      setSetting({
                        ...setting,
                        key:
                          event.target
                            .value,
                      })
                    }
                    placeholder="company_name"
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    Valor
                  </Label>

                  <Input
                    value={
                      setting.value
                    }
                    onChange={(
                      event,
                    ) =>
                      setSetting({
                        ...setting,
                        value:
                          event.target
                            .value,
                      })
                    }
                    placeholder='Lula Shop'
                  />

                  <p className="text-xs text-muted-foreground">
                    Puedes introducir texto, números,
                    booleanos o JSON.
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={
                    !isManager ||
                    !branchId ||
                    !setting.key.trim() ||
                    saveSetting.isPending
                  }
                  onClick={() =>
                    saveSetting.mutate()
                  }
                >
                  {saveSetting.isPending
                    ? "Guardando..."
                    : "Guardar configuración"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </PageShell>
  );
}