/**
 * Edge Function: admin-create-user
 *
 * Crea colaboradores para Lula OS usando:
 * - nombre
 * - PIN de 4 dígitos
 * - rol
 * - sucursal
 *
 * El correo y contraseña NO los captura el usuario.
 * Se generan internamente para conservar una identidad
 * real de Supabase Auth.
 *
 * IMPORTANTE:
 * - auth.uid() del colaborador sigue siendo real.
 * - cashier_id de las ventas no cambia.
 * - permisos existentes no cambian.
 * - inventario y create_sale() no se modifican.
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });
}

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
     * Cliente del administrador.
     *
     * Se mantiene el JWT real del usuario que está
     * ejecutando la operación.
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
        "is_admin:",
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
          "usuarios.manage:",
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

    const full_name = String(
      body.full_name ?? "",
    ).trim();

    const pin = String(
      body.pin ?? "",
    ).trim();

    const role = String(
      body.role ?? "cashier",
    ).trim();

    const branch_id =
      body.branch_id &&
      String(body.branch_id).trim()
        ? String(body.branch_id).trim()
        : null;

    if (!full_name) {
      return json(
        {
          error: "name required",
        },
        400,
      );
    }

    /*
     * El PIN es exactamente de 4 dígitos.
     */
    if (!/^\d{4}$/.test(pin)) {
      return json(
        {
          error:
            "PIN must contain exactly 4 digits",
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

    /*
     * El PIN está pensado para colaboradores.
     * El owner conserva su cuenta maestra.
     */
    if (role === "owner") {
      return json(
        {
          error:
            "owner accounts cannot use collaborator PIN",
        },
        400,
      );
    }

    /*
     * Un administrador tampoco puede crear owner.
     */
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
     * CREAR IDENTIDAD AUTH INTERNA
     * ----------------------------------------------------------
     *
     * El colaborador nunca necesita conocer este correo.
     * Se utiliza solamente para conservar un usuario real
     * de Supabase.
     */

    const internalId =
      crypto.randomUUID();

    const internalEmail =
      `collaborator_${internalId}@auth.lulashop.local`;

    const internalPassword =
      `${crypto.randomUUID()}-${crypto.randomUUID()}`;

    const {
      data: created,
      error: createError,
    } =
      await admin.auth.admin.createUser({
        email: internalEmail,
        password: internalPassword,
        email_confirm: true,
        user_metadata: {
          full_name,
          auth_mode: "collaborator_pin",
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
     * PROFILE
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

      const {
        error: rollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (rollbackError) {
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
     * ROL + SUCURSAL
     * ----------------------------------------------------------
     *
     * Sigue pasando por admin_set_user_access().
     * No hacemos INSERT directo a user_roles.
     */

    const {
      error: accessError,
    } =
      await userClient.rpc(
        "admin_set_user_access",
        {
          _user_id:
            createdUserId,
          _role:
            role,
          _branch_id:
            branch_id,
          _is_active:
            true,
        },
      );

    if (accessError) {
      console.error(
        "admin_set_user_access:",
        accessError.message,
      );

      await admin
        .from("profiles")
        .delete()
        .eq(
          "id",
          createdUserId,
        );

      const {
        error: authRollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (authRollbackError) {
        return json(
          {
            error:
              "role assignment failed and rollback failed",
            detail:
              accessError.message,
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
     * PIN
     * ----------------------------------------------------------
     *
     * El RPC existente:
     * admin_set_collaborator_pin()
     *
     * se encarga de validar:
     * - exactamente 4 dígitos
     * - colaborador activo
     * - no owner
     * - hash bcrypt
     */

    const {
      error: pinError,
    } =
      await userClient.rpc(
        "admin_set_collaborator_pin",
        {
          _user_id:
            createdUserId,
          _pin:
            pin,
        },
      );

    if (pinError) {
      console.error(
        "admin_set_collaborator_pin:",
        pinError.message,
      );

      /*
       * Rollback completo.
       */
      await admin
        .from("collaborator_pin_credentials")
        .delete()
        .eq(
          "user_id",
          createdUserId,
        );

      await admin
        .from("user_roles")
        .delete()
        .eq(
          "user_id",
          createdUserId,
        );

      await admin
        .from("profiles")
        .delete()
        .eq(
          "id",
          createdUserId,
        );

      const {
        error: authRollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (authRollbackError) {
        return json(
          {
            error:
              "PIN assignment failed and rollback failed",
            detail:
              pinError.message,
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
            "PIN assignment failed",
          detail:
            pinError.message,
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
        full_name,
        role,
        branch_id,
        auth_mode:
          "collaborator_pin",
      },
      200,
    );
  } catch (error) {
    console.error(
      "admin-create-user:",
      error,
    );

    /*
     * Si ocurrió una excepción después de crear Auth,
     * intentamos limpiar el usuario.
     */
    if (createdUserId) {
      try {
        const supabaseUrl =
          Deno.env.get(
            "SUPABASE_URL",
          );

        const serviceKey =
          Deno.env.get(
            "SUPABASE_SERVICE_ROLE_KEY",
          );

        if (
          supabaseUrl &&
          serviceKey
        ) {
          const admin =
            createClient(
              supabaseUrl,
              serviceKey,
            );

          await admin.auth.admin.deleteUser(
            createdUserId,
          );
        }
      } catch (rollbackError) {
        console.error(
          "exception rollback:",
          rollbackError,
        );
      }
    }

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