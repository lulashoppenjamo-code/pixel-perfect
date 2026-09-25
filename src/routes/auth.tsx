import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LogOut,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

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
      { title: "Acceso — Lula Shop OS" },
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

function AuthPage() {
  const navigate = useNavigate();

  const {
    user,
    profile,
    roles,
    loading,
    signOut,
  } = useAuth();

  const [mode, setMode] = useState<"login" | "signup">(
    "login",
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const hasActiveAccess =
    !!user &&
    !!profile &&
    profile.is_active === true &&
    roles.length > 0;

  const isPendingApproval =
    !!user &&
    !!profile &&
    profile.is_active === false;

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

  const submit = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    setBusy(true);

    try {
      if (mode === "signup") {
        const cleanName = fullName.trim();

        if (!cleanName) {
          throw new Error(
            "Escribe tu nombre completo.",
          );
        }

        const { error } =
          await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth`,
              data: {
                full_name: cleanName,
              },
            },
          });

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

      const { error } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (error) {
        throw error;
      }

      /*
       * AuthProvider actualizará profile/roles.
       * No forzamos aquí la navegación inmediatamente:
       * esperamos a saber si la cuenta está activa.
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

  const handleSignOut = async () => {
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-sm">
          <CardContent className="flex min-h-40 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />

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
   * Usuario autenticado pero pendiente de autorización.
   *
   * Importante:
   * no lo mandamos a /ventas porque todavía no tiene rol
   * operativo.
   */
  if (isPendingApproval) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-md">
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
              onClick={handleSignOut}
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
   * Si existe sesión pero todavía no llegó el profile,
   * mostramos espera en vez de mandar al usuario a una
   * pantalla protegida.
   */
  if (user && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <Card className="w-full max-w-sm">
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
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">
            Lula Shop OS
          </CardTitle>

          <CardDescription>
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
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={busy}
            >
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Entrar"
                  : "Crear cuenta"}
            </Button>
          </form>

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