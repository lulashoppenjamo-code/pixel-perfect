/**
 * Edge Function: collaborator-pin-login
 *
 * Flujo:
 *
 *   Tablet autorizada
 *        ↓
 *   device_secret + collaborator user_id + PIN
 *        ↓
 *   verify_collaborator_pin()
 *        ↓
 *   usuario real de Supabase
 *        ↓
 *   generateLink()
 *        ↓
 *   token_hash
 *        ↓
 *   cliente llama verifyOtp()
 *        ↓
 *   sesión real de Supabase
 *
 * IMPORTANTE:
 * - NO crea JWT manualmente.
 * - NO modifica auth.uid().
 * - NO modifica cashier_id.
 * - NO modifica ventas.
 * - NO modifica inventario.
 * - NO modifica permisos.
 * - NO expone la contraseña interna del colaborador.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function json(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json(
      {
        error: "method not allowed",
      },
      405,
    );
  }

  try {
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      console.error(
        "Missing Supabase environment variables",
      );

      return json(
        {
          error: "server misconfigured",
        },
        500,
      );
    }

    /*
     * ----------------------------------------------------------
     * BODY
     * ----------------------------------------------------------
     */

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return json(
        {
          error: "invalid json",
        },
        400,
      );
    }

    const deviceSecret =
      String(
        body.device_secret ?? "",
      ).trim();

    const userId =
      String(
        body.user_id ?? "",
      ).trim();

    const pin =
      String(
        body.pin ?? "",
      ).trim();

    /*
     * ----------------------------------------------------------
     * VALIDACIONES BÁSICAS
     * ----------------------------------------------------------
     */

    if (!deviceSecret) {
      return json(
        {
          error: "device secret required",
        },
        400,
      );
    }

    if (!userId) {
      return json(
        {
          error: "user id required",
        },
        400,
      );
    }

    if (!/^\d{4}$/.test(pin)) {
      return json(
        {
          error:
            "PIN must contain exactly 4 digits",
        },
        400,
      );
    }

    /*
     * ----------------------------------------------------------
     * CLIENTE ADMINISTRATIVO
     * ----------------------------------------------------------
     *
     * Service role solamente dentro de la Edge Function.
     */

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

    /*
     * ----------------------------------------------------------
     * 1. VERIFICAR DISPOSITIVO + PIN
     * ----------------------------------------------------------
     *
     * La función SQL ya se encarga de:
     *
     * - dispositivo activo
     * - colaborador activo
     * - owner bloqueado
     * - PIN correcto
     * - bloqueo por intentos
     * - bcrypt
     * - registrar último uso
     */

    const {
      data: verifiedUserId,
      error: verifyError,
    } = await admin.rpc(
      "verify_collaborator_pin",
      {
        _device_secret:
          deviceSecret,

        _user_id:
          userId,

        _pin:
          pin,
      },
    );

    if (verifyError) {
      console.error(
        "verify_collaborator_pin:",
        verifyError.message,
      );

      /*
       * No revelamos si falló:
       * - dispositivo
       * - usuario
       * - PIN
       * - bloqueo
       *
       * al cliente.
       */

      return json(
        {
          error:
            "invalid credentials",
        },
        401,
      );
    }

    if (
      !verifiedUserId ||
      verifiedUserId !== userId
    ) {
      return json(
        {
          error:
            "invalid credentials",
        },
        401,
      );
    }

    /*
     * ----------------------------------------------------------
     * 2. OBTENER USUARIO AUTH REAL
     * ----------------------------------------------------------
     */

    const {
      data: userData,
      error: userError,
    } =
      await admin.auth.admin.getUserById(
        userId,
      );

    if (
      userError ||
      !userData?.user
    ) {
      console.error(
        "getUserById:",
        userError?.message,
      );

      return json(
        {
          error:
            "collaborator not found",
        },
        401,
      );
    }

    const user =
      userData.user;

    /*
     * ----------------------------------------------------------
     * 3. VERIFICAR QUE LA CUENTA SIGA ACTIVA
     * ----------------------------------------------------------
     *
     * La función SQL ya valida profiles.is_active.
     * Aquí además comprobamos que Auth no esté bloqueado.
     */

    if (
      user.banned_until &&
      user.banned_until !== "none"
    ) {
      return json(
        {
          error:
            "collaborator unavailable",
        },
        403,
      );
    }

    /*
     * ----------------------------------------------------------
     * 4. CORREO INTERNO
     * ----------------------------------------------------------
     *
     * admin-create-user crea las cuentas con un correo interno
     * como:
     *
     * collaborator_UUID@auth.lulashop.local
     *
     * Ese correo nunca se muestra al colaborador.
     */

    const email =
      user.email;

    if (!email) {
      console.error(
        "Collaborator has no auth email",
      );

      return json(
        {
          error:
            "collaborator authentication is not configured",
        },
        500,
      );
    }

    /*
     * ----------------------------------------------------------
     * 5. GENERAR TOKEN DE MAGIC LINK
     * ----------------------------------------------------------
     *
     * Supabase genera:
     *
     * - action_link
     * - hashed_token
     *
     * Nosotros NO enviamos el action_link.
     *
     * Solamente devolvemos el hashed_token a la aplicación
     * que ya demostró tener:
     *
     * - dispositivo autorizado
     * - PIN correcto
     */

    const {
      data: linkData,
      error: linkError,
    } =
      await admin.auth.admin.generateLink(
        {
          type: "magiclink",
          email,
        },
      );

    if (
      linkError ||
      !linkData?.properties?.hashed_token
    ) {
      console.error(
        "generateLink:",
        linkError?.message,
      );

      return json(
        {
          error:
            "unable to create session",
        },
        500,
      );
    }

    /*
     * ----------------------------------------------------------
     * 6. DEVOLVER SOLAMENTE LO NECESARIO
     * ----------------------------------------------------------
     *
     * El cliente usará:
     *
     * supabase.auth.verifyOtp({
     *   token_hash,
     *   type: "email"
     * })
     *
     * para obtener la sesión real.
     */

    return json(
      {
        ok: true,

        user_id:
          user.id,

        token_hash:
          linkData.properties.hashed_token,

        type:
          "email",
      },
      200,
    );
  } catch (error) {
    console.error(
      "collaborator-pin-login:",
      error,
    );

    return json(
      {
        error:
          "internal server error",
      },
      500,
    );
  }
});