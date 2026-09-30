/**
 * Edge Function: admin-create-user
 * Crea colaborador con email/password y asigna rol + sucursal
 * vía admin_set_user_access (service role).
 *
 * Requiere Authorization: Bearer <user JWT admin>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "not authenticated" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: isAdmin, error: adminErr } = await admin.rpc("is_admin");
    // is_admin uses auth.uid() — call via userClient instead
    const { data: callerIsAdmin } = await userClient.rpc("is_admin");
    if (!callerIsAdmin) {
      return new Response(JSON.stringify({ error: "not authorized" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "cashier");
    const branch_id = body.branch_id ?? null;

    if (!email || !password || password.length < 6) {
      return new Response(
        JSON.stringify({ error: "email and password (min 6) required" }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (createErr || !created.user) {
      return new Response(
        JSON.stringify({ error: createErr?.message ?? "create failed" }),
        {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    const userId = created.user.id;

    // Ensure profile row exists (trigger may create it)
    await admin.from("profiles").upsert({
      id: userId,
      full_name: full_name || null,
      branch_id,
      is_active: true,
    });

    const { error: accessErr } = await admin.rpc("admin_set_user_access", {
      _user_id: userId,
      _role: role,
      _branch_id: branch_id,
      _is_active: true,
    });

    if (accessErr) {
      return new Response(
        JSON.stringify({
          error: accessErr.message,
          user_id: userId,
          note: "user created but role assignment failed",
        }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, user_id: userId, email }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
