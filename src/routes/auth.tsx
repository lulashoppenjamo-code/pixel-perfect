import {
  useEffect,
  useState,
} from "react";

import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";

import {
  ArrowLeft,
  LogOut,
  MonitorCheck,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";

import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import {
  getDeviceSecret,
  isDeviceMarkedAuthorized,
} from "@/lib/posDevice";

/**
 * BLOQUE 15 — Visual Auth / Login.
 * Solo presentación. Sin tocar signIn, PIN, device auth ni roles.
 */

import { CollaboratorPinLogin } from "@/components/auth/CollaboratorPinLogin";

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

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      {
        title: "Acceso — Lula Shop OS",
      },
      {
        name: "description",
        content:
          "Inicia sesión o crea tu cuenta para operar el punto de venta Lula Shop OS.",
      },
      {
        property: "og:title",
        content: "Acceso — Lula Shop OS",
      },
      {
        property: "og:description",
        content:
          "Inicia sesión o crea tu cuenta para operar el punto de venta Lula Shop OS.",
      },
    ],
  }),

  component: AuthPage,
});

type Collaborator = {
  user_id: string;
  full_name: string | null;
  branch_id: string | null;
};

function AuthPage() {
  const navigate = useNavigate();

  const {
    user,
    profile,
    roles,
    loading,
    signOut,
  } = useAuth();

  const [mode, setMode] = useState<
    "login" | "signup" | "collaborator"
  >("login");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [fullName, setFullName] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [signingOut, setSigningOut] =
    useState(false);

  const [deviceSecret, setDeviceSecret] =
    useState<string | null>(null);

  const [
    deviceAuthorized,
    setDeviceAuthorized,
  ] = useState(false);

  const [
    collaborators,
    setCollaborators,
  ] = useState<Collaborator[]>([]);

  const [
    collaboratorsLoading,
    setCollaboratorsLoading,
  ] = useState(false);

  const [
    collaboratorsError,
    setCollaboratorsError,
  ] = useState<string | null>(null);

  const [
    selectedCollaborator,
    setSelectedCollaborator,
  ] = useState<Collaborator | null>(
    null,
  );

  const hasActiveAccess =
    !!user &&
    !!profile &&
    profile.is_active === true &&
    roles.length > 0;

  const isPendingApproval =
    !!user &&
    !!profile &&
    profile.is_active === false;

  /*
   * ------------------------------------------------------------
   * Estado local del dispositivo
   * ------------------------------------------------------------
   */

  useEffect(() => {
    const secret = getDeviceSecret();

    setDeviceSecret(secret);
    setDeviceAuthorized(
      isDeviceMarkedAuthorized(),
    );
  }, []);

  /*
   * ------------------------------------------------------------
   * Si ya existe una sesión válida, conservar el comportamiento
   * actual: entrar directamente a Ventas.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (loading) {
      return;
    }

    if (hasActiveAccess) {
      void navigate({
        to: "/ventas",
        replace: true,
      });
    }
  }, [
    loading,
    hasActiveAccess,
    navigate,
  ]);

  /*
   * ------------------------------------------------------------
   * Cargar colaboradores cuando se entra al modo PIN.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    if (mode !== "collaborator") {
      return;
    }

    if (!deviceAuthorized) {
      setCollaborators([]);
      setCollaboratorsError(
        "Esta tablet todavía no está autorizada.",
      );
      return;
    }

    if (!deviceSecret) {
      setCollaborators([]);
      setCollaboratorsError(
        "No se encontró la identificación de esta tablet.",
      );
      return;
    }

    let cancelled = false;

    const loadCollaborators =
      async () => {
        setCollaboratorsLoading(
          true,
        );

        setCollaboratorsError(null);

        try {
          /*
           * La función SQL valida nuevamente que el dispositivo
           * esté autorizado.
           *
           * No confiamos únicamente en localStorage.
           */
          const {
            data,
            error,
          } = await (
            supabase as any
          ).rpc(
            "get_collaborators_for_pin_login",
            {
              _device_secret:
                deviceSecret,
            },
          );

          if (error) {
            throw error;
          }

          if (cancelled) {
            return;
          }

          setCollaborators(
            (data ??
              []) as Collaborator[],
          );
        } catch (error) {
          if (cancelled) {
            return;
          }

          setCollaborators([]);

          setCollaboratorsError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los colaboradores.",
          );
        } finally {
          if (!cancelled) {
            setCollaboratorsLoading(
              false,
            );
          }
        }
      };

    void loadCollaborators();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    deviceAuthorized,
    deviceSecret,
  ]);

  /*
   * ------------------------------------------------------------
   * Login normal
   * ------------------------------------------------------------
   */

  const submit = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    setBusy(true);

    try {
      if (mode === "signup") {
        const cleanName =
          fullName.trim();

        if (!cleanName) {
          throw new Error(
            "Escribe tu nombre completo.",
          );
        }

        const {
          error,
        } =
          await supabase.auth.signUp(
            {
              email: email.trim(),
              password,
              options: {
                emailRedirectTo:
                  `${window.location.origin}/auth`,
                data: {
                  full_name:
                    cleanName,
                },
              },
            },
          );

        if (error) {
          throw error;
        }

        toast.success(
          "Cuenta creada correctamente.",
        );

        setMode("login");
        setPassword("");

        return;
      }

      const {
        error,
      } =
        await supabase.auth.signInWithPassword(
          {
            email: email.trim(),
            password,
          },
        );

      if (error) {
        throw error;
      }

      /*
       * AuthProvider actualizará profile/roles.
       * No forzamos aquí la navegación inmediatamente.
       */
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo completar el acceso.",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
   * ------------------------------------------------------------
   * Cerrar sesión
   * ------------------------------------------------------------
   */

  const handleSignOut =
    async () => {
      if (signingOut) {
        return;
      }

      setSigningOut(true);

      try {
        await signOut();

        setEmail("");
        setPassword("");
        setFullName("");

        setMode("login");

        setSelectedCollaborator(
          null,
        );

        toast.success(
          "Sesión cerrada.",
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo cerrar la sesión.",
        );
      } finally {
        setSigningOut(false);
      }
    };

  /*
   * ------------------------------------------------------------
   * Volver al login principal
   * ------------------------------------------------------------
   */

  const backToLogin =
    () => {
      setMode("login");
      setSelectedCollaborator(
        null,
      );
      setCollaboratorsError(null);
    };

  /*
   * ------------------------------------------------------------
   * Loading inicial
   * ------------------------------------------------------------
   */

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4">
        <Card className="w-full max-w-sm rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
          <CardContent className="flex min-h-40 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />

              <p className="text-sm text-muted-foreground">
                Verificando acceso…
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * Usuario autenticado pero pendiente de autorización
   * ------------------------------------------------------------
   */

  if (isPendingApproval) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4">
        <Card className="w-full max-w-md rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
              <UserX className="h-7 w-7 text-amber-600" />
            </div>

            <CardTitle className="text-2xl">
              Cuenta pendiente de autorización
            </CardTitle>

            <CardDescription>
              Tu cuenta ya fue creada, pero todavía no
              tiene autorización para operar Lula Shop OS.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />

                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Acceso bloqueado temporalmente
                  </p>

                  <p className="text-sm text-muted-foreground">
                    Un administrador debe activar tu usuario
                    y asignarte una sucursal y un rol antes
                    de que puedas entrar al sistema.
                  </p>
                </div>
              </div>
            </div>

            {user?.email && (
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">
                  Cuenta
                </p>

                <p className="mt-1 break-all text-sm font-medium">
                  {user.email}
                </p>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={signingOut}
              onClick={
                handleSignOut
              }
            >
              <LogOut className="mr-2 h-4 w-4" />

              {signingOut
                ? "Cerrando sesión…"
                : "Cerrar sesión"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * Sesión existente pero todavía no llegó profile
   * ------------------------------------------------------------
   */

  if (user && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4">
        <Card className="w-full max-w-sm rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
          <CardContent className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <UserCheck className="h-7 w-7 text-primary" />
            </div>

            <div>
              <h2 className="text-lg font-semibold">
                Preparando tu cuenta
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Estamos verificando tus permisos de acceso.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={signingOut}
              onClick={
                handleSignOut
              }
            >
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * LOGIN POR PIN
   * ------------------------------------------------------------
   */

  if (
    mode === "collaborator"
  ) {
    /*
     * Si ya se seleccionó colaborador,
     * mostramos exclusivamente su PIN.
     */
    if (selectedCollaborator) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4">
          <Card className="w-full max-w-sm rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
            <CardHeader>
              <Button
                type="button"
                variant="ghost"
                className="mb-2 w-fit px-0"
                onClick={() =>
                  setSelectedCollaborator(
                    null,
                  )
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Cambiar colaborador
              </Button>

              <CardTitle className="text-2xl">
                Entrar como colaborador
              </CardTitle>

              <CardDescription>
                Ingresa el PIN de 4 dígitos de{" "}
                <span className="font-medium text-foreground">
                  {selectedCollaborator.full_name ||
                    "colaborador"}
                </span>
                .
              </CardDescription>
            </CardHeader>

            <CardContent>
              {deviceSecret ? (
                <CollaboratorPinLogin
                  userId={
                    selectedCollaborator.user_id
                  }
                  fullName={
                    selectedCollaborator.full_name ||
                    "Colaborador"
                  }
                  deviceSecret={
                    deviceSecret
                  }
                  onSuccess={() => {
                    /*
                     * La sesión Supabase ya quedó creada
                     * por CollaboratorPinLogin.
                     *
                     * No modificamos auth.uid().
                     * No modificamos cashier_id.
                     */
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                    No se encontró la identificación
                    de esta tablet.
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={
                      backToLogin
                    }
                  >
                    Volver
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    /*
     * ----------------------------------------------------------
     * Lista de colaboradores
     * ----------------------------------------------------------
     */

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 py-6">
        <Card className="w-full max-w-md rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
          <CardHeader>
            <Button
              type="button"
              variant="ghost"
              className="mb-2 w-fit px-0"
              onClick={
                backToLogin
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>

            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <MonitorCheck className="h-7 w-7 text-primary" />
            </div>

            <CardTitle className="text-center text-2xl">
              Entrar como colaborador
            </CardTitle>

            <CardDescription className="text-center">
              Selecciona tu nombre para continuar.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!deviceAuthorized && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

                  <div>
                    <p className="text-sm font-medium">
                      Tablet no autorizada
                    </p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      El dueño debe iniciar sesión y
                      autorizar esta tablet desde Ajustes
                      → Tablets y dispositivos POS.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {deviceAuthorized &&
              collaboratorsLoading && (
                <div className="flex min-h-32 items-center justify-center">
                  <div className="text-center">
                    <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />

                    <p className="text-sm text-muted-foreground">
                      Cargando colaboradores…
                    </p>
                  </div>
                </div>
              )}

            {deviceAuthorized &&
              !collaboratorsLoading &&
              collaboratorsError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-medium">
                    No se pudo verificar esta tablet
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {collaboratorsError}
                  </p>
                </div>
              )}

            {deviceAuthorized &&
              !collaboratorsLoading &&
              !collaboratorsError &&
              collaborators.length ===
                0 && (
                <div className="rounded-xl border bg-muted/30 p-4 text-center">
                  <p className="text-sm font-medium">
                    No hay colaboradores disponibles
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Un administrador debe crear colaboradores
                    y asignarles un PIN de 4 dígitos.
                  </p>
                </div>
              )}

            {deviceAuthorized &&
              !collaboratorsLoading &&
              !collaboratorsError &&
              collaborators.length >
                0 && (
                <div className="space-y-2">
                  {collaborators.map(
                    (
                      collaborator,
                    ) => (
                      <Button
                        key={
                          collaborator.user_id
                        }
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-start p-4 text-left"
                        onClick={() =>
                          setSelectedCollaborator(
                            collaborator,
                          )
                        }
                      >
                        <div className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <UserCheck className="h-5 w-5 text-primary" />
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {collaborator.full_name ||
                              "Colaborador"}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            Acceso con PIN de 4 dígitos
                          </p>
                        </div>
                      </Button>
                    ),
                  )}
                </div>
              )}

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={
                backToLogin
              }
            >
              Volver al acceso de administrador
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * LOGIN NORMAL / REGISTRO
   * ------------------------------------------------------------
   */

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4">
      <Card className="w-full max-w-sm rounded-2xl border border-[#e0e0e0] bg-white shadow-md">
        <CardHeader className="space-y-1 pb-2">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f0fe]">
            <ShieldCheck className="h-7 w-7 text-[#1a73e8]" />
          </div>
          <CardTitle className="text-center text-2xl font-bold text-[#212121]">
            Lula Shop OS
          </CardTitle>

          <CardDescription className="text-center text-[#757575]">
            {mode === "login"
              ? "Entra con tu correo y contraseña"
              : "Crea tu cuenta de trabajo"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={submit}
            className="space-y-4"
          >
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">
                  Nombre completo
                </Label>

                <Input
                  id="name"
                  value={fullName}
                  onChange={(event) =>
                    setFullName(
                      event.target.value,
                    )
                  }
                  autoComplete="name"
                  required
                  className="h-11 rounded-xl border-[#e0e0e0]"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">
                Correo
              </Label>

              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                autoComplete="email"
                required
                className="h-11 rounded-xl border-[#e0e0e0]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Contraseña
              </Label>

              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value,
                  )
                }
                minLength={6}
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                required
                className="h-11 rounded-xl border-[#e0e0e0]"
              />
            </div>

            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#34a853] text-[15px] font-bold text-white shadow-sm hover:bg-[#2d8f47]"
              disabled={busy}
            >
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Entrar"
                  : "Crear cuenta"}
            </Button>
          </form>

          {mode === "login" && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              onClick={() =>
                setMode(
                  "collaborator",
                )
              }
            >
              <UserCheck className="mr-2 h-4 w-4" />
              Entrar como colaborador
            </Button>
          )}

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() =>
              setMode(
                mode === "login"
                  ? "signup"
                  : "login",
              )
            }
          >
            {mode === "login"
              ? "No tengo cuenta, registrarme"
              : "Ya tengo cuenta, entrar"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}