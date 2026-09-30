/**
 * Edge Function: admin-create-user
 *
 * Lula OS v1.1
 *
 * - Autoriza al usuario llamador mediante su JWT.
 * - Requiere is_admin o usuarios.manage.
 * - Solo owner puede asignar owner.
 * - Crea el usuario mediante service role.
 * - Crea/actualiza profile mediante service role.
 * - Asigna rol/sucursal mediante el JWT del llamador.
 * - Si falla profile o asignación de acceso, intenta hacer rollback.
 * - No modifica inventario, ventas ni create_sale.
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
    return new Response("ok", {
      headers: cors,
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

  let createdUserId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const anonKey = Deno.env.get(
      "SUPABASE_ANON_KEY",
    );

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json(
        {
          error: "server misconfigured",
        },
        500,
      );
    }

    const authHeader =
      req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return json(
        {
          error: "missing auth",
        },
        401,
      );
    }

    /*
     * Cliente del usuario que está haciendo la solicitud.
     *
     * Es importante que admin_set_user_access se ejecute
     * con este cliente y NO con service role porque esa función
     * utiliza auth.uid().
     */
    const userClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: {
        user: caller,
      },
      error: callerError,
    } = await userClient.auth.getUser();

    if (callerError || !caller) {
      return json(
        {
          error: "not authenticated",
        },
        401,
      );
    }

    /*
     * ----------------------------------------------------------
     * AUTORIZACIÓN
     * ----------------------------------------------------------
     */

    const {
      data: callerIsAdmin,
      error: adminCheckError,
    } = await userClient.rpc("is_admin");

    if (adminCheckError) {
      console.error(
        "is_admin check:",
        adminCheckError.message,
      );
    }

    let callerCanManage =
      callerIsAdmin === true;

    if (!callerCanManage) {
      const {
        data: hasManage,
        error: permissionError,
      } = await userClient.rpc(
        "has_permission",
        {
          _permission_key:
            "usuarios.manage",
        },
      );

      if (permissionError) {
        console.error(
          "usuarios.manage check:",
          permissionError.message,
        );
      }

      callerCanManage =
        hasManage === true;
    }

    if (!callerCanManage) {
      return json(
        {
          error: "not authorized",
        },
        403,
      );
    }

    /*
     * ----------------------------------------------------------
     * DETERMINAR SI EL LLAMADOR ES OWNER
     * ----------------------------------------------------------
     */

    const {
      data: callerRoles,
      error: rolesError,
    } = await userClient.rpc(
      "get_my_roles",
    );

    if (rolesError) {
      console.error(
        "get_my_roles:",
        rolesError.message,
      );
    }

    const callerIsOwner =
      Array.isArray(callerRoles) &&
      callerRoles.includes("owner");

    /*
     * ----------------------------------------------------------
     * BODY
     * ----------------------------------------------------------
     */

    const body = await req.json();

    const email = String(
      body.email ?? "",
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password ?? "",
    );

    const full_name = String(
      body.full_name ?? "",
    ).trim();

    const role = String(
      body.role ?? "cashier",
    ).trim();

    const branch_id =
      body.branch_id &&
      String(body.branch_id).trim()
        ? String(body.branch_id).trim()
        : null;

    if (!email || !email.includes("@")) {
      return json(
        {
          error: "valid email required",
        },
        400,
      );
    }

    if (
      !password ||
      password.length < 6
    ) {
      return json(
        {
          error:
            "password min 6 characters",
        },
        400,
      );
    }

    if (!ALLOWED_ROLES.has(role)) {
      return json(
        {
          error: "invalid role",
        },
        400,
      );
    }

    if (
      role === "owner" &&
      !callerIsOwner
    ) {
      return json(
        {
          error:
            "only owner can assign owner role",
        },
        403,
      );
    }

    /*
     * ----------------------------------------------------------
     * SERVICE ROLE
     * ----------------------------------------------------------
     */

    const admin = createClient(
      supabaseUrl,
      serviceKey,
    );

    /*
     * ----------------------------------------------------------
     * CREAR USUARIO AUTH
     * ----------------------------------------------------------
     */

    const {
      data: created,
      error: createError,
    } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name,
        },
      });

    if (
      createError ||
      !created.user
    ) {
      return json(
        {
          error:
            createError?.message ??
            "create failed",
        },
        400,
      );
    }

    createdUserId =
      created.user.id;

    /*
     * ----------------------------------------------------------
     * CREAR / ACTUALIZAR PROFILE
     * ----------------------------------------------------------
     */

    const {
      error: profileError,
    } = await admin
      .from("profiles")
      .upsert({
        id: createdUserId,
        full_name:
          full_name || null,
        branch_id,
        is_active: true,
      });

    if (profileError) {
      console.error(
        "profile upsert:",
        profileError.message,
      );

      /*
       * Rollback del usuario Auth.
       */
      const {
        error: rollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (rollbackError) {
        console.error(
          "rollback auth user:",
          rollbackError.message,
        );

        return json(
          {
            error:
              "profile creation failed and rollback failed",
            detail:
              profileError.message,
            rollback:
              rollbackError.message,
            user_id:
              createdUserId,
          },
          500,
        );
      }

      return json(
        {
          error:
            "profile creation failed",
          detail:
            profileError.message,
        },
        500,
      );
    }

    /*
     * ----------------------------------------------------------
     * ASIGNAR ROL + SUCURSAL
     *
     * IMPORTANTE:
     * usar userClient porque admin_set_user_access
     * depende de auth.uid().
     * ----------------------------------------------------------
     */

    const {
      error: accessError,
    } =
      await userClient.rpc(
        "admin_set_user_access",
        {
          _user_id:
            createdUserId,
          _role: role,
          _branch_id:
            branch_id,
          _is_active: true,
        },
      );

    if (accessError) {
      console.error(
        "admin_set_user_access:",
        accessError.message,
      );

      /*
       * Primero eliminamos el profile.
       */
      const {
        error: profileRollbackError,
      } =
        await admin
          .from("profiles")
          .delete()
          .eq(
            "id",
            createdUserId,
          );

      if (profileRollbackError) {
        console.error(
          "profile rollback:",
          profileRollbackError.message,
        );
      }

      /*
       * Después eliminamos el usuario Auth.
       */
      const {
        error: authRollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (authRollbackError) {
        console.error(
          "auth rollback:",
          authRollbackError.message,
        );

        return json(
          {
            error:
              "role assignment failed and rollback failed",
            detail:
              accessError.message,
            profile_rollback:
              profileRollbackError?.message ??
              null,
            auth_rollback:
              authRollbackError.message,
            user_id:
              createdUserId,
          },
          500,
        );
      }

      return json(
        {
          error:
            "role assignment failed",
          detail:
            accessError.message,
        },
        500,
      );
    }

    /*
     * ----------------------------------------------------------
     * ÉXITO
     * ----------------------------------------------------------
     */

    return json(
      {
        ok: true,
        user_id:
          createdUserId,
        email,
        role,
        branch_id,
      },
      200,
    );
  } catch (error) {
    console.error(
      "admin-create-user:",
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "error",
      },
      500,
    );
  }
});

function json(
  body: unknown,
  status: number,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...cors,
        "Content-Type":
          "application/json",
      },
    },
  );
}