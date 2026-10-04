import { useEffect, useState } from "react";
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
  Trash2,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  PageHeader,
  PageShell,
} from "@/components/PageHeader";

import { BluetoothPrinterSettings } from "@/components/settings/BluetoothPrinterSettings";
import { TicketPrinterSettings } from "@/components/settings/TicketPrinterSettings";

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

const COLLABORATOR_ROLES: AppRole[] = [
  "admin",
  "manager",
  "cashier",
  "staff",
];

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  staff: "Ayudante general",
};

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
    can,
  } = useAuth();

  const canManageUsers =
    can("usuarios.manage") || isAdmin;

  const [inviteOpen, setInviteOpen] =
    useState(false);

  const [inviteForm, setInviteForm] =
    useState({
      full_name: "",
      pin: "",
      role: "staff" as AppRole,
      branch_id: "",
    });

  const [invitePending, setInvitePending] =
    useState(false);

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

  const [myProfileForm, setMyProfileForm] =
    useState({
      full_name: "",
      branch_id: "none",
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
   * Eliminar sucursal = desactivar sucursal (is_active = false).
   *
   * NO elimina historial ni datos operativos.
   * Preferimos el RPC admin_delete_branch(uuid).
   * Si el RPC no existe en el proyecto remoto, usamos
   * un fallback seguro con UPDATE directo (solo admin).
   */
  const deleteBranch =
    useMutation({
      mutationFn:
        async (
          branchIdToDelete: string,
        ) => {
          if (!isAdmin) {
            throw new Error(
              "No tienes permiso para eliminar sucursales.",
            );
          }

          if (!branchIdToDelete) {
            throw new Error(
              "No se indicó la sucursal a eliminar.",
            );
          }

          const activeCount =
            branches.length;

          if (activeCount <= 1) {
            throw new Error(
              "No puedes eliminar la última sucursal activa.",
            );
          }

          const mapRpcError = (
            raw: string,
          ) => {
            const msg = raw.toLowerCase();

            if (
              msg.includes("not authorized") ||
              msg.includes("permission")
            ) {
              return "No tienes permiso de administrador para eliminar sucursales.";
            }

            if (
              msg.includes("last active") ||
              msg.includes("última")
            ) {
              return "No puedes eliminar la última sucursal activa.";
            }

            if (msg.includes("not found")) {
              return "La sucursal no existe o ya fue eliminada.";
            }

            if (msg.includes("not authenticated")) {
              return "Sesión expirada. Vuelve a iniciar sesión.";
            }

            return (
              raw ||
              "No se pudo eliminar la sucursal."
            );
          };

          // 1) RPC oficial
          const { error: rpcError } =
            await (
              supabase as unknown as {
                rpc: (
                  fn: string,
                  args: Record<
                    string,
                    unknown
                  >,
                ) => Promise<{
                  error: {
                    message?: string;
                    code?: string;
                  } | null;
                }>;
              }
            ).rpc(
              "admin_delete_branch",
              {
                _branch_id:
                  branchIdToDelete,
              },
            );

          if (!rpcError) {
            return;
          }

          const rpcMsg =
            rpcError.message ?? "";

          const rpcCode =
            rpcError.code ?? "";

          const rpcMissing =
            rpcCode === "PGRST202" ||
            rpcMsg
              .toLowerCase()
              .includes(
                "could not find the function",
              ) ||
            rpcMsg
              .toLowerCase()
              .includes(
                "admin_delete_branch",
              );

          // 2) Fallback
          if (rpcMissing) {
            const {
              error: updateError,
            } = await supabase
              .from("branches")
              .update({
                is_active: false,
              })
              .eq(
                "id",
                branchIdToDelete,
              );

            if (updateError) {
              throw new Error(
                mapRpcError(
                  updateError.message,
                ) ||
                  "No se pudo desactivar la sucursal (permisos RLS).",
              );
            }

            await supabase
              .from("profiles")
              .update({
                branch_id: null,
              })
              .eq(
                "branch_id",
                branchIdToDelete,
              );

            return;
          }

          throw new Error(
            mapRpcError(rpcMsg),
          );
        },

      onSuccess: () => {
        toast.success(
          "Sucursal desactivada correctamente.",
        );

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

        void qc.invalidateQueries({
          queryKey: [
            "settings",
          ],
        });
      },

      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : typeof error ===
                  "object" &&
                error !== null &&
                "message" in error
              ? String(
                  (
                    error as {
                      message?: unknown;
                    }
                  ).message ?? "",
                )
              : "";

        toast.error(
          message ||
            "No se pudo eliminar la sucursal.",
        );
      },
    });

  /*
   * Guarda los datos básicos de la sesión actual.
   */
  const saveMyProfile =
    useMutation({
      mutationFn:
        async ({
          fullName,
          branchId: myBranchId,
        }: {
          fullName: string;
          branchId: string | null;
        }) => {
          if (!user?.id) {
            throw new Error(
              "No hay una sesión de usuario válida.",
            );
          }

          const name =
            fullName.trim();

          if (!name) {
            throw new Error(
              "El nombre es obligatorio.",
            );
          }

          const {
            error,
          } = await supabase
            .from("profiles")
            .update({
              full_name:
                name,
              branch_id:
                myBranchId,
            })
            .eq(
              "id",
              user.id,
            );

          if (error) {
            throw error;
          }
        },

      onSuccess: () => {
        toast.success(
          "Mis datos fueron actualizados.",
        );

        void qc.invalidateQueries({
          queryKey: [
            "profiles",
          ],
        });

        void qc.invalidateQueries({
          queryKey: [
            "branches",
          ],
        });
      },

      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron actualizar tus datos.",
        ),
    });

  /*
   * Administración segura de usuarios.
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

  const currentProfile =
    profiles.find(
      (profile) =>
        profile.id === user?.id,
    );

  const currentRole =
    currentProfile?.roles[0] ??
    "owner";

  const currentRoleLabel =
    ROLE_LABELS[currentRole];

  const currentBranchName =
    currentProfile?.branch_id
      ? getBranchName(
          currentProfile.branch_id,
        )
      : "Todas las sucursales";

  useEffect(() => {
    if (!currentProfile) {
      return;
    }

    setMyProfileForm({
      full_name:
        currentProfile.full_name ??
        "",
      branch_id:
        currentProfile.branch_id ??
        "none",
    });
  }, [
    currentProfile?.id,
    currentProfile?.full_name,
    currentProfile?.branch_id,
  ]);

  /*
   * Crea colaborador usando:
   * Nombre + PIN + Rol + Sucursal.
   *
   * El correo y contraseña ya NO se capturan
   * en la interfaz.
   *
   * El Edge Function genera internamente
   * las credenciales técnicas de Supabase.
   */
  const submitInvite = async () => {
    if (!canManageUsers) {
      toast.error("No autorizado");
      return;
    }

    const fullName =
      inviteForm.full_name.trim();

    const pin =
      inviteForm.pin.trim();

    if (!fullName) {
      toast.error(
        "El nombre es obligatorio.",
      );
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      toast.error(
        "El PIN debe tener exactamente 4 dígitos.",
      );
      return;
    }

    if (
      !COLLABORATOR_ROLES.includes(
        inviteForm.role,
      )
    ) {
      toast.error(
        "Selecciona un rol válido para el colaborador.",
      );
      return;
    }

    setInvitePending(true);

    try {
      const {
        data: sessionData,
      } =
        await supabase.auth.getSession();

      const token =
        sessionData.session
          ?.access_token;

      if (!token) {
        throw new Error(
          "Sesión no válida",
        );
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${token}`,
            apikey:
              import.meta.env
                .VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            full_name:
              fullName,
            pin,
            role:
              inviteForm.role,
            branch_id:
              inviteForm.branch_id ||
              null,
          }),
        },
      );

      const json =
        await res.json();

      if (!res.ok) {
        throw new Error(
          json.error ||
            "No se pudo crear el colaborador.",
        );
      }

      toast.success(
        "Colaborador creado correctamente.",
      );

      setInviteOpen(false);

      setInviteForm({
        full_name: "",
        pin: "",
        role: "staff",
        branch_id: "",
      });

      void qc.invalidateQueries({
        queryKey: [
          "profiles",
        ],
      });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Error al crear colaborador",
      );
    } finally {
      setInvitePending(false);
    }
  };

  const handleDeleteBranch = (
    branchIdToDelete: string,
    branchName: string,
  ) => {
    if (!isAdmin) {
      toast.error(
        "No tienes permiso para eliminar sucursales.",
      );
      return;
    }

    const confirmed =
      window.confirm(
        `¿Desactivar la sucursal "${branchName}"?\n\nLa sucursal dejará de estar activa, pero no se eliminará el historial ni los datos operativos.`,
      );

    if (!confirmed) {
      return;
    }

    deleteBranch.mutate(
      branchIdToDelete,
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
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-[#e0e0e0] bg-white p-1 shadow-sm">
          <TabsTrigger
            value="sucursales"
            className="min-h-10 rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
          >
            Sucursales
          </TabsTrigger>

          {isAdmin && (
            <TabsTrigger
              value="usuarios"
              className="min-h-10 rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              Usuarios y roles
            </TabsTrigger>
          )}

          {isManager && (
            <TabsTrigger
              value="general"
              className="min-h-10 rounded-lg px-3 text-xs data-[state=active]:bg-[#1a73e8] data-[state=active]:text-white sm:text-sm"
            >
              General
            </TabsTrigger>
          )}
        </TabsList>

        {/* ================================================== */}
        {/* SUCURSALES */}
        {/* ================================================== */}

        <TabsContent
          value="sucursales"
          className="grid max-w-full gap-4 overflow-x-hidden lg:grid-cols-[1fr_340px]"
        >
          <Card>
            <CardHeader>
              <CardTitle>
                Sucursales activas
              </CardTitle>
            </CardHeader>

            <CardContent className="max-w-full overflow-x-auto px-3 sm:px-6">
              <div className="grid gap-2.5 lg:hidden">
                {branches.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-[#e0e0e0] bg-white p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-bold text-[#212121]">
                            {item.name}
                          </p>

                          <p className="mt-0.5 text-xs text-[#757575]">
                            {item.address ??
                              "Sin dirección"}
                          </p>

                          <p className="mt-0.5 text-xs text-[#9e9e9e]">
                            {item.phone ??
                              "Sin teléfono"}
                          </p>
                        </div>

                        {isAdmin && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                            disabled={
                              deleteBranch.isPending
                            }
                            onClick={() =>
                              handleDeleteBranch(
                                item.id,
                                item.name,
                              )
                            }
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Eliminar
                          </Button>
                        )}
                      </div>
                    </div>
                  ),
                )}

                {!branches.length && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No hay sucursales registradas.
                  </p>
                )}
              </div>

              <div className="hidden overflow-x-auto lg:block">
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

                      {isAdmin && (
                        <TableHead className="text-right">
                          Acciones
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {branches.map(
                      (item) => (
                        <TableRow
                          key={
                            item.id
                          }
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

                          {isAdmin && (
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                                disabled={
                                  deleteBranch.isPending
                                }
                                onClick={() =>
                                  handleDeleteBranch(
                                    item.id,
                                    item.name,
                                  )
                                }
                              >
                                <Trash2 className="mr-1.5 h-4 w-4" />
                                Eliminar
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ),
                    )}

                    {!branches.length && (
                      <TableRow>
                        <TableCell
                          colSpan={
                            isAdmin
                              ? 4
                              : 3
                          }
                          className="py-8 text-center text-muted-foreground"
                        >
                          No hay sucursales activas
                          disponibles para tu usuario.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
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
                  Solo propietario o administrador
                  pueden crear sucursales.
                </p>
              )}

              <div className="space-y-2">
                <Label>
                  Nombre
                </Label>

                <Input
                  className="h-11"
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
                className="min-h-11 w-full touch-manipulation rounded-xl bg-[#1a73e8] text-[15px] font-semibold hover:bg-[#1557b0]"
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
            {/* ================================================== */}
            {/* MI SESIÓN */}
            {/* ================================================== */}

            <Card className="mb-4 border-[#e0e0e0] shadow-sm">
              <CardHeader>
                <CardTitle>
                  Mi sesión
                </CardTitle>

                <p className="text-sm text-muted-foreground">
                  Puedes actualizar tu nombre y la
                  sucursal asignada. La cuenta propietaria
                  mantiene protegido su rol.
                </p>
              </CardHeader>

              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>
                      Nombre
                    </Label>

                    <Input
                      className="h-11"
                      value={
                        myProfileForm.full_name
                      }
                      onChange={(event) =>
                        setMyProfileForm(
                          (form) => ({
                            ...form,
                            full_name:
                              event.target.value,
                          }),
                        )
                      }
                      placeholder="Nombre completo"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Rol
                    </Label>

                    <Select
                      value={
                        currentRole
                      }
                      disabled={
                        currentRole ===
                        "owner"
                      }
                      onValueChange={(
                        value,
                      ) =>
                        setUserAccess.mutate(
                          {
                            userId:
                              user?.id ??
                              "",
                            role:
                              value as AppRole,
                            bid:
                              currentProfile?.branch_id ??
                              null,
                            active:
                              currentProfile?.is_active ??
                              true,
                          },
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
                              key={
                                role
                              }
                              value={
                                role
                              }
                            >
                              {
                                ROLE_LABELS[
                                  role
                                ]
                              }
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>

                    {currentRole ===
                      "owner" && (
                      <p className="text-xs text-amber-600">
                        El rol Propietario está protegido
                        para evitar bloquear la cuenta principal.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Sucursal
                    </Label>

                    <Select
                      value={
                        myProfileForm.branch_id
                      }
                      onValueChange={(
                        value,
                      ) =>
                        setMyProfileForm(
                          (form) => ({
                            ...form,
                            branch_id:
                              value,
                          }),
                        )
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Sucursal" />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="none">
                          Todas las sucursales
                        </SelectItem>

                        {branches.map(
                          (item) => (
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
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    className="min-h-11 rounded-xl bg-[#1a73e8] font-semibold hover:bg-[#1557b0]"
                    disabled={
                      !user?.id ||
                      !myProfileForm.full_name.trim() ||
                      saveMyProfile.isPending
                    }
                    onClick={() =>
                      saveMyProfile.mutate(
                        {
                          fullName:
                            myProfileForm.full_name,
                          branchId:
                            myProfileForm.branch_id ===
                            "none"
                              ? null
                              : myProfileForm.branch_id,
                        },
                      )
                    }
                  >
                    {saveMyProfile.isPending
                      ? "Guardando..."
                      : "Guardar mis datos"}
                  </Button>

                  <Badge
                    variant="outline"
                    className="rounded-full"
                  >
                    {currentRoleLabel}
                  </Badge>

                  <Badge
                    variant="outline"
                    className="rounded-full"
                  >
                    {currentBranchName}
                  </Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border bg-[#f8f9fa] p-4">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Usuario
                    </p>

                    <p className="mt-1 font-semibold">
                      {currentProfile?.full_name?.trim() ||
                        "Sin nombre"}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-[#f8f9fa] p-4">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Rol actual
                    </p>

                    <p className="mt-1 font-semibold">
                      {currentRoleLabel}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-[#f8f9fa] p-4">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Sucursal actual
                    </p>

                    <p className="mt-1 font-semibold">
                      {currentBranchName}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 md:col-span-3">
                    <Badge className="rounded-full border-transparent bg-[#e8f5e9] text-[#2e7d32]">
                      Sesión activa
                    </Badge>

                    <Badge variant="outline">
                      Acceso administrativo
                    </Badge>

                    {currentRole ===
                      "owner" && (
                      <Badge variant="outline">
                        Propietario protegido
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ================================================== */}
            {/* USUARIOS Y PERMISOS */}
            {/* ================================================== */}

            <Card className="border-[#e0e0e0] shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Usuarios y permisos
                    </CardTitle>

                    <p className="mt-1 text-sm text-muted-foreground">
                      El acceso se controla desde
                      Supabase. Los cambios de rol,
                      sucursal y activación se realizan
                      de forma atómica.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {profiles.length} usuario
                      {profiles.length === 1
                        ? ""
                        : "s"}
                    </Badge>

                    {canManageUsers && (
                      <Button
                        size="sm"
                        className="min-h-10 rounded-xl bg-[#1a73e8]"
                        onClick={() =>
                          setInviteOpen(true)
                        }
                      >
                        Crear colaborador
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="max-w-full overflow-x-auto px-3 sm:px-6">
                {profilesLoading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Cargando usuarios...
                  </div>
                ) : (
                  <>
                    {/* Móvil */}
                    <div className="grid gap-2.5 lg:hidden">
                      {profiles.map(
                        (profile) => {
                          const role =
                            getUserRole(
                              profile,
                            );

                          const current =
                            isCurrentUser(
                              profile.id,
                            );

                          return (
                            <div
                              key={
                                profile.id
                              }
                              className="rounded-xl border border-[#e0e0e0] bg-white p-3.5 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[15px] font-bold text-[#212121]">
                                    {profile.full_name?.trim() ||
                                      "Sin nombre"}
                                  </p>

                                  <p className="mt-0.5 text-[11px] text-[#9e9e9e]">
                                    {current
                                      ? "Sesión actual"
                                      : profile.id.slice(
                                          0,
                                          8,
                                        ) +
                                        "…"}
                                  </p>
                                </div>

                                {profile.is_active ? (
                                  <Badge className="shrink-0 gap-1 rounded-full border-transparent bg-[#e8f5e9] text-[#2e7d32]">
                                    Activo
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="secondary"
                                    className="shrink-0 rounded-full border-transparent bg-[#eeeeee] text-[#757575]"
                                  >
                                    Inactivo
                                  </Badge>
                                )}
                              </div>

                              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-[#f5f5f5] p-2.5 text-xs">
                                <div>
                                  <p className="text-[10px] font-medium uppercase text-[#757575]">
                                    Rol
                                  </p>

                                  <p className="mt-0.5 font-semibold text-[#212121]">
                                    {
                                      ROLE_LABELS[
                                        role
                                      ]
                                    }
                                  </p>
                                </div>

                                <div>
                                  <p className="text-[10px] font-medium uppercase text-[#757575]">
                                    Sucursal
                                  </p>

                                  <p className="mt-0.5 font-semibold text-[#212121]">
                                    {getBranchName(
                                      profile.branch_id,
                                    )}
                                  </p>
                                </div>
                              </div>

                              <p className="mt-2 text-[11px] text-[#9e9e9e]">
                                Usa la vista de escritorio
                                para cambiar rol, sucursal
                                o activación de otros usuarios.
                              </p>
                            </div>
                          );
                        },
                      )}

                      {!profiles.length && (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No hay perfiles para mostrar.
                        </p>
                      )}
                    </div>

                    {/* Desktop */}
                    <div className="hidden overflow-x-auto lg:block">
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
                                              {
                                                ROLE_LABELS[
                                                  item
                                                ]
                                              }
                                            </SelectItem>
                                          ),
                                        )}
                                      </SelectContent>
                                    </Select>

                                    {owner && (
                                      <p className="mt-1 text-[11px] font-medium text-amber-600">
                                        Propietario protegido
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
                                      <Badge className="gap-1 rounded-full border-transparent bg-[#e8f5e9] text-[#2e7d32]">
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
                                      <Badge variant="outline">
                                        Sesión actual
                                      </Badge>
                                    ) : owner ? (
                                      <Badge variant="outline">
                                        Propietario
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
                    </div>
                  </>
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
            className="space-y-4"
          >
            <BluetoothPrinterSettings />

            <TicketPrinterSettings />

            <div className="grid max-w-full gap-4 overflow-x-hidden lg:grid-cols-[1fr_340px]">
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

                <CardContent className="max-w-full overflow-x-auto">
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
                      placeholder="Lula Shop"
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
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* ================================================== */}
      {/* CREAR COLABORADOR */}
      {/* ================================================== */}

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);

          if (!open) {
            setInviteForm({
              full_name: "",
              pin: "",
              role: "staff",
              branch_id: "",
            });
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              Crear colaborador
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                Nombre
              </Label>

              <Input
                className="h-11"
                value={
                  inviteForm.full_name
                }
                onChange={(e) =>
                  setInviteForm(
                    (f) => ({
                      ...f,
                      full_name:
                        e.target.value,
                    }),
                  )
                }
                placeholder="Nombre completo"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                PIN de 4 dígitos
              </Label>

              <Input
                className="h-11 text-center text-lg tracking-[0.35em]"
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]*"
                value={
                  inviteForm.pin
                }
                onChange={(e) => {
                  const value =
                    e.target.value
                      .replace(
                        /\D/g,
                        "",
                      )
                      .slice(
                        0,
                        4,
                      );

                  setInviteForm(
                    (f) => ({
                      ...f,
                      pin: value,
                    }),
                  );
                }}
                placeholder="••••"
                autoComplete="new-password"
              />

              <p className="text-xs text-muted-foreground">
                Este será el PIN que utilizará
                el colaborador para entrar a vender.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>
                Rol
              </Label>

              <Select
                value={
                  inviteForm.role
                }
                onValueChange={(
                  value,
                ) =>
                  setInviteForm(
                    (f) => ({
                      ...f,
                      role:
                        value as AppRole,
                    }),
                  )
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {COLLABORATOR_ROLES.map(
                    (role) => (
                      <SelectItem
                        key={role}
                        value={role}
                      >
                        {
                          ROLE_LABELS[
                            role
                          ]
                        }
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Sucursal
              </Label>

              <Select
                value={
                  inviteForm.branch_id ||
                  "none"
                }
                onValueChange={(
                  value,
                ) =>
                  setInviteForm(
                    (f) => ({
                      ...f,
                      branch_id:
                        value ===
                        "none"
                          ? ""
                          : value,
                    }),
                  )
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Sucursal" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="none">
                    Sin asignar
                  </SelectItem>

                  {branches.map(
                    (b) => (
                      <SelectItem
                        key={b.id}
                        value={b.id}
                      >
                        {b.name}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="min-h-11 w-full rounded-xl bg-[#43a047] font-semibold hover:bg-[#388e3c]"
              disabled={
                invitePending ||
                !inviteForm.full_name.trim() ||
                !/^\d{4}$/.test(
                  inviteForm.pin,
                )
              }
              onClick={() =>
                void submitInvite()
              }
            >
              {invitePending
                ? "Creando…"
                : "Crear colaborador"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}