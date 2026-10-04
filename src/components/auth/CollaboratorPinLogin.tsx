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

export function CollaboratorPinLogin({
  userId,
  fullName,
  deviceSecret,
  onSuccess,
}: CollaboratorPinLoginProps) {
  const navigate = useNavigate();

  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (
    event: React.FormEvent,
  ) => {
    event.preventDefault();

    const cleanPin = pin.trim();

    if (!/^\d{4}$/.test(cleanPin)) {
      toast.error(
        "El PIN debe tener exactamente 4 dígitos.",
      );
      return;
    }

    if (!deviceSecret) {
      toast.error(
        "Esta tablet todavía no está autorizada.",
      );
      return;
    }

    if (!userId) {
      toast.error(
        "No se encontró el colaborador.",
      );
      return;
    }

    setBusy(true);

    try {
      /*
       * ------------------------------------------------------
       * 1. VERIFICAR DISPOSITIVO + PIN
       * ------------------------------------------------------
       */

      const {
        data,
        error,
      } =
        await supabase.functions.invoke(
          "collaborator-pin-login",
          {
            body: {
              device_secret:
                deviceSecret,

              user_id:
                userId,

              pin:
                cleanPin,
            },
          },
        );

      if (error) {
        throw new Error(
          "PIN incorrecto o acceso no autorizado.",
        );
      }

      const tokenHash =
        data?.token_hash;

      if (
        !data?.ok ||
        !tokenHash
      ) {
        throw new Error(
          "No se pudo crear la sesión.",
        );
      }

      /*
       * ------------------------------------------------------
       * 2. CONVERTIR TOKEN EN SESIÓN REAL
       * ------------------------------------------------------
       *
       * Supabase crea la sesión.
       *
       * No creamos JWT.
       * No asignamos auth.uid().
       * No tocamos cashier_id.
       */

      const {
        data: sessionData,
        error: otpError,
      } =
        await supabase.auth.verifyOtp({
          token_hash:
            tokenHash,

          type:
            "email",
        });

      if (
        otpError ||
        !sessionData.session
      ) {
        throw new Error(
          "No se pudo establecer la sesión del colaborador.",
        );
      }

      /*
       * ------------------------------------------------------
       * 3. VERIFICACIÓN FINAL
       * ------------------------------------------------------
       */

      if (
        sessionData.session.user.id !==
        userId
      ) {
        await supabase.auth.signOut();

        throw new Error(
          "La identidad autenticada no coincide con el colaborador.",
        );
      }

      toast.success(
        `Bienvenido, ${fullName || "colaborador"}.`,
      );

      setPin("");

      onSuccess?.();

      await navigate({
        to: "/ventas",
        replace: true,
      });
    } catch (error) {
      console.error(
        "[COLLABORATOR PIN LOGIN]",
        error,
      );

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

        <CardTitle>
          {fullName}
        </CardTitle>

        <CardDescription>
          Introduce tu PIN de 4 dígitos
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={submit}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="collaborator-pin">
              PIN
            </Label>

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
                const value =
                  event.target.value
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
            disabled={
              busy ||
              pin.length !== 4
            }
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