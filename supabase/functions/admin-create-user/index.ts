/**
 * Edge Function: admin-create-user
 *
 * CORRECCIÓN v1.1 seguridad:
 * - Autoriza con JWT del llamador (is_admin / usuarios.manage)
 * - Crea usuario con service role
 * - Asigna rol/sucursal con el cliente del LLAMADOR
 *   (admin_set_user_access usa auth.uid(); service role no tiene uid)
 * - Una sola sucursal (branch_id)
 * - No permite escalar a owner salvo que el llamador sea owner
 * - Valida rol contra app_role conocidos
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ROLES = new Set([
  "owner",
  "admin",
  "manager",
  "cashier",
  "staff",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: "server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "missing auth" }, 401);
    }

    // Cliente del llamador (respeta auth.uid en RPCs)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return json({ error: "not authenticated" }, 401);
    }

    // Autorización: admin O permiso usuarios.manage
    const { data: callerIsAdmin } = await userClient.rpc("is_admin");
    let callerCanManage = callerIsAdmin === true;

    if (!callerCanManage) {
      const { data: hasManage } = await userClient.rpc("has_permission", {
        _permission_key: "usuarios.manage",
      });
      callerCanManage = hasManage === true;
    }

    if (!callerCanManage) {
      return json({ error: "not authorized" }, 403);
    }

    // ¿El llamador es owner? (para impedir escalada)
    const { data: callerRoles } = await userClient.rpc("get_my_roles");
    const callerIsOwner = Array.isArray(callerRoles)
      ? callerRoles.includes("owner")
      : false;

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "cashier").trim();
    const branch_id =
      body.branch_id && String(body.branch_id).trim()
        ? String(body.branch_id).trim()
        : null;

    if (!email || !email.includes("@")) {
      return json({ error: "valid email required" }, 400);
    }

    if (!password || password.length < 6) {
      return json({ error: "password min 6 characters" }, 400);
    }

    if (!ALLOWED_ROLES.has(role)) {
      return json({ error: "invalid role" }, 400);
    }

    if (role === "owner" && !callerIsOwner) {
      return json({ error: "only owner can assign owner role" }, 403);
    }

    // Service role solo para createUser (no para admin_set_user_access)
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (createErr || !created.user) {
      return json(
        { error: createErr?.message ?? "create failed" },
        400,
      );
    }

    const userId = created.user.id;

    // Perfil con service role (bypass RLS de profiles si aplica)
    const { error: profileErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: full_name || null,
      branch_id,
      is_active: true,
    });

    if (profileErr) {
      console.error("profile upsert", profileErr.message);
    }

    // Rol + sucursal con JWT del llamador (auth.uid = admin)
    const { error: accessErr } = await userClient.rpc(
      "admin_set_user_access",
      {
        _user_id: userId,
        _role: role,
        _branch_id: branch_id,
        _is_active: true,
      },
    );

    if (accessErr) {
      return json(
        {
          error: accessErr.message,
          user_id: userId,
          note: "user created but role assignment failed",
        },
        500,
      );
    }

    return json({ ok: true, user_id: userId, email }, 200);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "error" },
      500,
    );
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}
