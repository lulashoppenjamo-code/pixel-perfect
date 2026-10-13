
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, LockKeyhole, UserRound } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

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

type CollaboratorPinLoginProps = {
  userId: string;
  fullName: string;
  deviceSecret: string;
  onSuccess?: () => void;
};

/** Traduce errores técnicos de la edge function a mensajes claros. */
function mapPinLoginError(raw: string | undefined | null): string {
  const msg = (raw ?? "").toLowerCase();

  if (!msg) {
    return "No se pudo crear la sesión.";
  }

  if (
    msg.includes("invalid credentials") ||
    (msg.includes("pin") && msg.includes("incorrect"))
  ) {
    return "PIN incorrecto o acceso no autorizado.";
  }

  if (msg.includes("pin not configured")) {
    return "Este colaborador no tiene PIN configurado.";
  }

  if (msg.includes("temporarily locked") || msg.includes("locked")) {
    return "PIN bloqueado temporalmente. Espera unos minutos.";
  }

  if (msg.includes("device") || msg.includes("secret")) {
    return "Esta tablet no está autorizada.";
  }

  if (msg.includes("collaborator not found")) {
    return "Colaborador no encontrado en Auth.";
  }

  if (
    msg.includes("authentication is not configured") ||
    msg.includes("no auth email") ||
    msg.includes("has no auth email")
  ) {
    return "La cuenta del colaborador no tiene correo de Auth. Vuelve a crearla.";
  }

  if (
    msg.includes("unable to create session") ||
    msg.includes("generateLink") ||
    msg.includes("token")
  ) {
    return "No se pudo generar el token de sesión. Revisa logs de la edge function.";
  }

  if (msg.includes("collaborator unavailable") || msg.includes("banned")) {
    return "Colaborador no disponible.";
  }

  if (msg.includes("owner")) {
    return "El owner debe entrar con el login de administrador.";
  }

  if (msg.includes("server misconfigured")) {
    return "Servidor mal configurado (faltan variables de Supabase).";
  }

  // Mensaje original si no hay traducción conocida
  return raw!.trim() || "No se pudo iniciar sesión.";
}

export function CollaboratorPinLogin({
  userId,
  fullName,
  deviceSecret,
  onSuccess,
}: CollaboratorPinLoginProps) {
  const navigate = useNavigate();

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const cleanPin = pin.trim();

    if (!/^\d{4}$/.test(cleanPin)) {
      toast.error("El PIN debe tener exactamente 4 dígitos.");
      return;
    }

    if (!deviceSecret) {
      toast.error("Esta tablet todavía no está autorizada.");
      return;
    }

    if (!userId) {
      toast.error("No se encontró el colaborador.");
      return;
    }

    setBusy(true);

    try {
      // 1. Verificar dispositivo autorizado y PIN.
      const { data, error } = await supabase.functions.invoke(
        "collaborator-pin-login",
        {
          body: {
            device_secret: deviceSecret,
            user_id: userId,
            pin: cleanPin,
          },
        },
      );

      // La edge function puede devolver error HTTP con body { error: "..." }
      // o success con { ok, token_hash, type }.
      const bodyError =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
          ? String((data as { error: string }).error)
          : null;

      if (error || bodyError) {
        const detail =
          bodyError ||
          (error instanceof Error ? error.message : null) ||
          (typeof error === "object" &&
          error !== null &&
          "message" in error
            ? String((error as { message?: string }).message ?? "")
            : null);

        console.error("[COLLABORATOR PIN LOGIN] invoke failed", {
          error,
          data,
          detail,
        });

        throw new Error(mapPinLoginError(detail));
      }

      const tokenHash =
        data && typeof data === "object"
          ? (data as { token_hash?: string }).token_hash
          : undefined;

      const ok =
        data && typeof data === "object"
          ? (data as { ok?: boolean }).ok
          : false;

      const type =
        data && typeof data === "object"
          ? (data as { type?: string }).type
          : undefined;

      if (!ok || type !== "magiclink" || !tokenHash) {
        console.error("[COLLABORATOR PIN LOGIN] respuesta incompleta", data);
        throw new Error(
          mapPinLoginError(
            (data as { error?: string } | null)?.error ??
              "unable to create session",
          ),
        );
      }

      // 2. Intercambiar el token por una sesión real de Supabase.
      const { data: sessionData, error: otpError } =
        await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });

      if (otpError || !sessionData.session) {
        console.error("[COLLABORATOR PIN LOGIN] verifyOtp", otpError);
        throw new Error(
          otpError?.message
            ? `No se pudo establecer la sesión: ${otpError.message}`
            : "No se pudo establecer la sesión del colaborador.",
        );
      }

      // 3. Confirmar que la sesión corresponde al colaborador.
      if (sessionData.session.user.id !== userId) {
        await supabase.auth.signOut();

        throw new Error(
          "La identidad autenticada no coincide con el colaborador.",
        );
      }

      toast.success(`Bienvenido, ${fullName || "colaborador"}.`);

      setPin("");
      onSuccess?.();

      await navigate({
        to: "/ventas",
        replace: true,
      });
    } catch (error) {
      console.error("[COLLABORATOR PIN LOGIN]", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar sesión.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <UserRound className="h-7 w-7 text-primary" />
        </div>

        <CardTitle>{fullName}</CardTitle>

        <CardDescription>
          Introduce tu PIN de 4 dígitos
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="collaborator-pin">PIN</Label>

            <Input
              id="collaborator-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              autoFocus
              value={pin}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 4);

                setPin(value);
              }}
              className="h-14 text-center text-2xl tracking-[0.5em]"
            />
          </div>

          <Button
            type="submit"
            className="h-12 w-full"
            disabled={busy || pin.length !== 4}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verificando…
              </>
            ) : (
              <>
                <LockKeyhole className="mr-2 h-4 w-4" />
                Entrar
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
