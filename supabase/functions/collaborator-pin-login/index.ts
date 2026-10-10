
/**
 * Edge Function: collaborator-pin-login
 *
 * Flujo:
 * Tablet autorizada -> device_secret + user_id + PIN
 * -> verify_collaborator_pin() -> usuario Auth real
 * -> generateLink(magiclink) -> token_hash
 * -> cliente verifyOtp(magiclink) -> sesión real
 *
 * No crea JWT manualmente ni modifica ventas, inventario,
 * cashier_id o permisos.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json({ error: "server misconfigured" }, 500);
    }

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const deviceSecret = String(
      body.device_secret ?? "",
    ).trim();

    const userId = String(body.user_id ?? "").trim();
    const pin = String(body.pin ?? "").trim();

    if (!deviceSecret) {
      return json({ error: "device secret required" }, 400);
    }

    if (!userId) {
      return json({ error: "user id required" }, 400);
    }

    if (!/^\d{4}$/.test(pin)) {
      return json(
        { error: "PIN must contain exactly 4 digits" },
        400,
      );
    }

    // Service role: solamente dentro de esta función.
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // 1. Verificar dispositivo autorizado y PIN.
    const {
      data: verifiedUserId,
      error: verifyError,
    } = await admin.rpc("verify_collaborator_pin", {
      _device_secret: deviceSecret,
      _user_id: userId,
      _pin: pin,
    });

    if (verifyError) {
      console.error(
        "verify_collaborator_pin:",
        verifyError.message,
      );

      return json({ error: "invalid credentials" }, 401);
    }

    if (!verifiedUserId || verifiedUserId !== userId) {
      return json({ error: "invalid credentials" }, 401);
    }

    // 2. Obtener el usuario real de Supabase Auth.
    const {
      data: userData,
      error: userError,
    } = await admin.auth.admin.getUserById(userId);

    if (userError || !userData?.user) {
      console.error("getUserById:", userError?.message);
      return json({ error: "collaborator not found" }, 401);
    }

    const user = userData.user;

    // 3. Comprobar que la cuenta no esté bloqueada.
    // El cast evita depender de que la versión del tipo User
    // declare explícitamente la propiedad banned_until.
    const bannedUntil = (
      user as typeof user & {
        banned_until?: string | null;
      }
    ).banned_until;

    if (bannedUntil && bannedUntil !== "none") {
      return json(
        { error: "collaborator unavailable" },
        403,
      );
    }

    // 4. Correo interno asociado a la cuenta Auth.
    const email = user.email;

    if (!email) {
      console.error("Collaborator has no auth email");

      return json(
        {
          error:
            "collaborator authentication is not configured",
        },
        500,
      );
    }

    // 5. Generar un magic link sin enviar el enlace por correo.
    const {
      data: linkData,
      error: linkError,
    } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    const tokenHash = linkData?.properties?.hashed_token;

    if (linkError || !tokenHash) {
      console.error("generateLink:", linkError?.message);

      return json(
        { error: "unable to create session" },
        500,
      );
    }

    // 6. Devolver el token y su tipo real.
    return json(
      {
        ok: true,
        user_id: user.id,
        token_hash: tokenHash,
        type: "magiclink",
      },
      200,
    );
  } catch (error) {
    console.error("collaborator-pin-login:", error);

    return json(
      { error: "internal server error" },
      500,
    );
  }
});
