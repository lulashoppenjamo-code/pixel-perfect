import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Monitor, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useBranch } from "@/lib/branch";

import {
  getOrCreateDeviceSecret,
  getDeviceName,
  setDeviceName,
  setDeviceAuthorized,
  isDeviceMarkedAuthorized,
} from "@/lib/posDevice";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
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

import { Badge } from "@/components/ui/badge";

type AuthorizedDevice = {
  id: string;
  device_name: string;
  branch_id: string | null;
  authorized_by: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
};

export function PosDeviceAuthorization() {
  const { isAdmin, can } = useAuth();

  const { branches } = useBranch();

  const qc = useQueryClient();

  const canManageDevices =
    isAdmin ||
    can("usuarios.manage");

  const [deviceName, setDeviceNameState] =
    useState(
      getDeviceName() ||
        "Tablet Lula Shop",
    );

  const [selectedBranch, setSelectedBranch] =
    useState<string>("none");

  const [saving, setSaving] =
    useState(false);

  const [localAuthorized, setLocalAuthorized] =
    useState(
      isDeviceMarkedAuthorized(),
    );

  useEffect(() => {
    const currentName =
      getDeviceName();

    if (currentName) {
      setDeviceNameState(
        currentName,
      );
    }
  }, []);

  const {
    data: devices = [],
    isLoading,
  } =
    useQuery<AuthorizedDevice[]>({
      queryKey: [
        "authorized-pos-devices",
      ],

      enabled:
        canManageDevices,

      queryFn: async () => {
        const {
          data,
          error,
        } = await supabase
          .from(
            "authorized_pos_devices",
          )
          .select(
            "id, device_name, branch_id, authorized_by, is_active, created_at, last_used_at",
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          );

        if (error) {
          throw error;
        }

        return (
          data ?? []
        ) as AuthorizedDevice[];
      },
    });

  if (!canManageDevices) {
    return null;
  }

  const authorizeDevice =
    async () => {
      const cleanName =
        deviceName.trim();

      if (!cleanName) {
        toast.error(
          "Escribe un nombre para la tablet.",
        );
        return;
      }

      setSaving(true);

      try {
        /*
         * El secreto se crea una sola vez
         * y permanece local en esta tablet.
         */
        const deviceSecret =
          getOrCreateDeviceSecret();

        const branchId =
          selectedBranch === "none"
            ? null
            : selectedBranch;

        const {
          data,
          error,
        } =
          await (
            supabase as any
          ).rpc(
            "admin_authorize_pos_device",
            {
              _device_name:
                cleanName,

              _device_secret:
                deviceSecret,

              _branch_id:
                branchId,
            },
          );

        if (error) {
          throw error;
        }

        /*
         * Guardamos únicamente información
         * local de estado/nombre.
         *
         * El secreto ya quedó guardado por
         * getOrCreateDeviceSecret().
         */
        setDeviceName(
          cleanName,
        );

        setDeviceAuthorized(
          true,
        );

        setLocalAuthorized(
          true,
        );

        toast.success(
          "Esta tablet quedó autorizada correctamente.",
        );

        void qc.invalidateQueries({
          queryKey: [
            "authorized-pos-devices",
          ],
        });

        /*
         * Evita que TypeScript marque como
         * no utilizado el resultado del RPC
         * en proyectos con distintas versiones
         * del cliente Supabase.
         */
        void data;
      } catch (error: unknown) {
        console.error("[AUTHORIZE POS DEVICE]", error);

        const details =
          typeof error === "object" && error !== null
            ? error as { message?: string; details?: string; hint?: string; code?: string }
            : null;

        const message = [
          details?.message,
          details?.details,
          details?.hint,
          details?.code ? `Código: ${details.code}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        toast.error(message || "No se pudo autorizar la tablet. Revisa la consola.");
      } finally {
        setSaving(false);
      }
    };

  const revokeDevice =
    async (
      deviceId: string,
    ) => {
      if (!deviceId) {
        return;
      }

      const confirmed =
        window.confirm(
          "¿Revocar este dispositivo? Los colaboradores ya no podrán iniciar sesión mediante PIN desde esa tablet.",
        );

      if (!confirmed) {
        return;
      }

      try {
        const {
          error,
        } =
          await (
            supabase as any
          ).rpc(
            "admin_revoke_pos_device",
            {
              _device_id:
                deviceId,
            },
          );

        if (error) {
          throw error;
        }

        toast.success(
          "Dispositivo revocado.",
        );

        /*
         * Si el dispositivo revocado es
         * esta misma tablet, quitamos también
         * la marca local.
         *
         * El secreto NO se elimina automáticamente:
         * así evitamos generar uno nuevo
         * accidentalmente.
         */
        const currentName =
          getDeviceName();

        const isCurrentDevice =
          currentName !== null &&
          devices.some(
            (device) =>
              device.id ===
              deviceId &&
              device.device_name ===
                currentName,
          );

        if (isCurrentDevice) {
          setDeviceAuthorized(
            false,
          );

          setLocalAuthorized(
            false,
          );
        }

        void qc.invalidateQueries({
          queryKey: [
            "authorized-pos-devices",
          ],
        });
      } catch (error) {
        console.error(
          "[REVOKE POS DEVICE]",
          error,
        );

        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo revocar el dispositivo.",
        );
      }
    };

  const branchName = (
    branchId: string | null,
  ) => {
    if (!branchId) {
      return "Sin sucursal predeterminada";
    }

    return (
      branches.find(
        (branch) =>
          branch.id ===
          branchId,
      )?.name ??
      "Sucursal"
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Tablets y dispositivos POS
            </CardTitle>

            <CardDescription>
              Autoriza las tablets para permitir
              el acceso rápido de colaboradores
              mediante PIN.
            </CardDescription>
          </div>

          {localAuthorized && (
            <Badge className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Esta tablet autorizada
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />

            <div>
              <h3 className="font-medium">
                Autorizar esta tablet
              </h3>

              <p className="text-sm text-muted-foreground">
                Solo necesitas hacerlo una vez
                por dispositivo.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pos-device-name">
                Nombre del dispositivo
              </Label>

              <Input
                id="pos-device-name"
                value={deviceName}
                disabled={saving}
                onChange={(event) =>
                  setDeviceNameState(
                    event.target.value,
                  )
                }
                placeholder="Ej. Tablet Caja 1"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Sucursal predeterminada
              </Label>

              <Select
                value={selectedBranch}
                disabled={saving}
                onValueChange={
                  setSelectedBranch
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una sucursal" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="none">
                    Sin sucursal predeterminada
                  </SelectItem>

                  {branches.map(
                    (branch) => (
                      <SelectItem
                        key={branch.id}
                        value={branch.id}
                      >
                        {branch.name}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4">
            <Button
              type="button"
              onClick={
                authorizeDevice
              }
              disabled={saving}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />

              {saving
                ? "Autorizando…"
                : localAuthorized
                  ? "Autorizar nuevamente"
                  : "Autorizar esta tablet"}
            </Button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-medium">
            Dispositivos autorizados
          </h3>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              Cargando dispositivos…
            </p>
          ) : devices.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay dispositivos autorizados.
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map(
                (device) => (
                  <div
                    key={device.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {device.device_name}
                        </span>

                        {device.is_active ? (
                          <Badge variant="secondary">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            Revocado
                          </Badge>
                        )}

                        {localAuthorized &&
                          device.device_name ===
                            getDeviceName() &&
                          device.is_active && (
                            <Badge>
                              Esta tablet
                            </Badge>
                          )}
                      </div>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {branchName(
                          device.branch_id,
                        )}
                      </p>

                      {device.last_used_at && (
                        <p className="text-xs text-muted-foreground">
                          Último uso:{" "}
                          {new Date(
                            device.last_used_at,
                          ).toLocaleString(
                            "es-MX",
                          )}
                        </p>
                      )}
                    </div>

                    {device.is_active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void revokeDevice(
                            device.id,
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Revocar
                      </Button>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}