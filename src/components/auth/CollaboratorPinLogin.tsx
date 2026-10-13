
/**
 * Edge Function: collaborator-pin-login
 *
 * Flujo:
 * Tablet autorizada -> device_secret + user_id + PIN
 * -> verify_collaborator_pin() -> usuario Auth real
 * -> (si hace falta) normalizar email Auth
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

/** Emails @*.local suelen fallar en generateLink de Supabase Auth. */
function needsEmailNormalization(email: string): boolean {
  const e = email.trim().toLowerCase();
  return (
    e.endsWith(".local") ||
    e.endsWith(".localhost") ||
    e.includes("@auth.lulashop.local")
  );
}

function normalizedCollaboratorEmail(userId: string): string {
  // Dominio sintético pero con TLD válido para Auth (no se envía correo).
  const id = userId.replace(/-/g, "");
  return `collaborator.${id}@pin.lulashop.app`;
}

function extractHashedToken(linkData: unknown): string | null {
  if (!linkData || typeof linkData !== "object") return null;

  const root = linkData as Record<string, unknown>;
  const props = (root.properties ?? null) as Record<
    string,
    unknown
  > | null;

  const candidates = [
    props?.hashed_token,
    root.hashed_token,
    props?.email_otp,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c.trim();
    }
  }

  // Último recurso: token en action_link
  const actionLink =
    typeof props?.action_link === "string"
      ? props.action_link
      : typeof root.action_link === "string"
        ? root.action_link
        : null;

  if (actionLink) {
    try {
      const url = new URL(actionLink);
      const token =
        url.searchParams.get("token") ||
        url.searchParams.get("token_hash");
      if (token && token.trim()) return token.trim();
    } catch {
      // ignore
    }
  }

  return null;
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

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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

      const m = (verifyError.message || "").toLowerCase();
      if (m.includes("locked")) {
        return json({ error: "PIN temporarily locked" }, 401);
      }
      if (m.includes("not configured")) {
        return json({ error: "PIN not configured" }, 401);
      }
      if (m.includes("owner")) {
        return json(
          { error: "owner must use administrator login" },
          403,
        );
      }

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

    let user = userData.user;

    // 3. Cuenta bloqueada
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

    // 4. Asegurar email usable para generateLink
    let email = (user.email ?? "").trim();

    if (!email) {
      const newEmail = normalizedCollaboratorEmail(userId);
      const { data: updated, error: updateErr } =
        await admin.auth.admin.updateUserById(userId, {
          email: newEmail,
          email_confirm: true,
        });

      if (updateErr || !updated?.user?.email) {
        console.error(
          "updateUserById (assign email):",
          updateErr?.message,
        );
        return json(
          {
            error:
              "collaborator authentication is not configured",
            detail: updateErr?.message ?? "no email",
          },
          500,
        );
      }

      user = updated.user;
      email = updated.user.email!;
    } else if (needsEmailNormalization(email)) {
      // Emails @*.local suelen romper generateLink
      const newEmail = normalizedCollaboratorEmail(userId);
      console.log(
        "Normalizing collaborator auth email",
        { from: email, to: newEmail, userId },
      );

      const { data: updated, error: updateErr } =
        await admin.auth.admin.updateUserById(userId, {
          email: newEmail,
          email_confirm: true,
        });

      if (updateErr || !updated?.user?.email) {
        console.error(
          "updateUserById (normalize email):",
          updateErr?.message,
        );
        // Seguimos intentando con el email original
      } else {
        user = updated.user;
        email = updated.user.email!;
      }
    }

    // Confirmar email por si quedó sin confirmar
    if (user.email_confirmed_at == null) {
      const { error: confirmErr } =
        await admin.auth.admin.updateUserById(userId, {
          email_confirm: true,
        });
      if (confirmErr) {
        console.error(
          "email_confirm:",
          confirmErr.message,
        );
      }
    }

    // 5. Generar magic link (sin enviar correo)
    let linkData: unknown = null;
    let linkErrorMessage: string | null = null;

    {
      const result = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (result.error) {
        linkErrorMessage = result.error.message;
        console.error("generateLink magiclink:", result.error.message);
      } else {
        linkData = result.data;
      }
    }

    // Reintento con redirectTo si el primero falló
    if (!extractHashedToken(linkData)) {
      const result = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: supabaseUrl,
        },
      });

      if (result.error) {
        linkErrorMessage =
          result.error.message || linkErrorMessage;
        console.error(
          "generateLink magiclink+redirect:",
          result.error.message,
        );
      } else {
        linkData = result.data;
      }
    }

    const tokenHash = extractHashedToken(linkData);

    if (!tokenHash) {
      console.error("generateLink failed completely", {
        email,
        userId,
        linkErrorMessage,
        linkDataKeys:
          linkData && typeof linkData === "object"
            ? Object.keys(linkData as object)
            : [],
        properties:
          linkData &&
          typeof linkData === "object" &&
          (linkData as { properties?: unknown }).properties
            ? Object.keys(
                (
                  linkData as {
                    properties: Record<string, unknown>;
                  }
                ).properties,
              )
            : [],
      });

      return json(
        {
          error: "unable to create session",
          detail:
            linkErrorMessage ??
            "missing hashed_token from generateLink",
        },
        500,
      );
    }

    // 6. Devolver el token
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
 