/**
 * Edge Function: admin-create-user
 *
 * Crea colaboradores para Lula Shop OS usando:
 * - nombre
 * - PIN de 4 dígitos
 * - rol
 * - sucursal
 *
 * El usuario nunca proporciona ni conoce las credenciales
 * técnicas de Supabase Auth.
 *
 * Flujo:
 *
 *   administrador
 *        ↓
 *   admin-create-user
 *        ↓
 *   Auth user
 *        ↓
 *   profiles
 *        ↓
 *   admin_set_user_access()
 *        ↓
 *   admin_set_collaborator_pin()
 *
 * Si cualquier paso posterior a Auth falla,
 * se intenta hacer rollback completo.
 *
 * NO modifica:
 * - ventas
 * - create_sale()
 * - inventario
 * - stock compartido
 * - cashier_id
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

const ALLOWED_ROLES = new Set([
  "admin",
  "manager",
  "cashier",
  "staff",
]);

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
        "Content-Type":
          "application/json",
      },
    },
  );
}

function errorMessage(
  error: unknown,
) {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return String(
      (
        error as {
          message?: unknown;
        }
      ).message ?? "",
    );
  }

  return String(error ?? "");
}

Deno.serve(async (req) => {
  /*
   * ----------------------------------------------------------
   * CORS
   * ----------------------------------------------------------
   */

  if (
    req.method ===
    "OPTIONS"
  ) {
    return new Response(
      "ok",
      {
        headers:
          corsHeaders,
      },
    );
  }

  /*
   * ----------------------------------------------------------
   * MÉTODO
   * ----------------------------------------------------------
   */

  if (
    req.method !==
    "POST"
  ) {
    return json(
      {
        error:
          "method not allowed",
      },
      405,
    );
  }

  let createdUserId:
    | string
    | null = null;

  try {
    /*
     * --------------------------------------------------------
     * VARIABLES DEL SERVIDOR
     * --------------------------------------------------------
     */

    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL",
      );

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const anonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY",
      );

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !anonKey
    ) {
      console.error(
        "admin-create-user: missing Supabase environment variables",
      );

      return json(
        {
          error:
            "server misconfigured",
        },
        500,
      );
    }

    /*
     * --------------------------------------------------------
     * AUTENTICACIÓN DEL ADMINISTRADOR
     * --------------------------------------------------------
     */

    const authHeader =
      req.headers.get(
        "Authorization",
      );

    if (
      !authHeader ||
      !authHeader.startsWith(
        "Bearer ",
      )
    ) {
      return json(
        {
          error:
            "missing auth",
        },
        401,
      );
    }

    /*
     * Cliente que conserva el JWT real del administrador.
     *
     * Este cliente se utiliza para ejecutar RPCs que dependen
     * de auth.uid().
     */

    const userClient =
      createClient(
        supabaseUrl,
        anonKey,
        {
          auth: {
            autoRefreshToken:
              false,
            persistSession:
              false,
          },

          global: {
            headers: {
              Authorization:
                authHeader,
            },
          },
        },
      );

    /*
     * Verificar identidad.
     */

    const {
      data:
        userData,
      error:
        userError,
    } =
      await userClient.auth.getUser();

    const caller =
      userData?.user;

    if (
      userError ||
      !caller
    ) {
      console.error(
        "getUser:",
        userError?.message,
      );

      return json(
        {
          error:
            "not authenticated",
        },
        401,
      );
    }

    /*
     * --------------------------------------------------------
     * AUTORIZACIÓN
     * --------------------------------------------------------
     */

    const {
      data:
        callerIsAdmin,
      error:
        adminCheckError,
    } =
      await userClient.rpc(
        "is_admin",
      );

    if (
      adminCheckError
    ) {
      console.error(
        "is_admin:",
        adminCheckError.message,
      );
    }

    let callerCanManage =
      callerIsAdmin ===
      true;

    if (
      !callerCanManage
    ) {
      const {
        data:
          hasManage,
        error:
          permissionError,
      } =
        await userClient.rpc(
          "has_permission",
          {
            _permission_key:
              "usuarios.manage",
          },
        );

      if (
        permissionError
      ) {
        console.error(
          "has_permission:",
          permissionError.message,
        );
      }

      callerCanManage =
        hasManage === true;
    }

    if (
      !callerCanManage
    ) {
      return json(
        {
          error:
            "not authorized",
        },
        403,
      );
    }

    /*
     * --------------------------------------------------------
     * BODY
     * --------------------------------------------------------
     */

    let body:
      | Record<
          string,
          unknown
        >
      | null = null;

    try {
      const parsed =
        await req.json();

      if (
        typeof parsed !==
        "object" ||
        parsed === null ||
        Array.isArray(
          parsed,
        )
      ) {
        return json(
          {
            error:
              "invalid request body",
          },
          400,
        );
      }

      body =
        parsed as Record<
          string,
          unknown
        >;
    } catch {
      return json(
        {
          error:
            "invalid json",
        },
        400,
      );
    }

    /*
     * --------------------------------------------------------
     * DATOS DEL COLABORADOR
     * --------------------------------------------------------
     */

    const fullName =
      String(
        body.full_name ??
          "",
      ).trim();

    const pin =
      String(
        body.pin ?? "",
      ).trim();

    const role =
      String(
        body.role ??
          "staff",
      ).trim();

    const rawBranchId =
      body.branch_id;

    const branchId =
      rawBranchId !==
        null &&
      rawBranchId !==
        undefined &&
      String(
        rawBranchId,
      ).trim()
        ? String(
            rawBranchId,
          ).trim()
        : null;

    /*
     * --------------------------------------------------------
     * VALIDACIONES
     * --------------------------------------------------------
     */

    if (!fullName) {
      return json(
        {
          error:
            "name required",
        },
        400,
      );
    }

    if (
      fullName.length >
      150
    ) {
      return json(
        {
          error:
            "name too long",
        },
        400,
      );
    }

    if (
      !/^\d{4}$/.test(
        pin,
      )
    ) {
      return json(
        {
          error:
            "PIN must contain exactly 4 digits",
        },
        400,
      );
    }

    if (
      !ALLOWED_ROLES.has(
        role,
      )
    ) {
      return json(
        {
          error:
            "invalid role",
        },
        400,
      );
    }

    /*
     * El owner utiliza su cuenta maestra.
     *
     * Los colaboradores creados mediante este flujo
     * nunca reciben el rol owner.
     */

    if (
      role ===
      "owner"
    ) {
      return json(
        {
          error:
            "owner accounts cannot use collaborator PIN",
        },
        400,
      );
    }

    /*
     * --------------------------------------------------------
     * CLIENTE SERVICE ROLE
     * --------------------------------------------------------
     *
     * Este cliente solamente existe dentro de la Edge
     * Function. Nunca se envía al navegador.
     */

    const admin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken:
              false,
            persistSession:
              false,
          },
        },
      );

    /*
     * --------------------------------------------------------
     * CREAR USUARIO AUTH
     * --------------------------------------------------------
     *
     * IMPORTANTE:
     *
     * Esta contraseña NO es el PIN.
     *
     * Se utiliza únicamente para que Supabase Auth tenga
     * una identidad real para el colaborador.
     *
     * Se usa una contraseña deliberadamente corta y
     * conocida únicamente por este proceso.
     *
     * Esto elimina completamente el problema de:
     *
     * "Password cannot be longer than 72 characters"
     *
     * El PIN real se administra mediante:
     *
     * admin_set_collaborator_pin()
     */

    const internalId =
      crypto.randomUUID();

    const internalEmail =
      `collaborator_${internalId}@auth.lulashop.local`;

    /*
     * 32 caracteres.
     *
     * Muy por debajo del límite de 72 caracteres de
     * Supabase Auth/bcrypt.
     *
     * NO es el PIN del colaborador.
     */

    const internalPassword =
      crypto
        .randomUUID()
        .replaceAll(
          "-",
          "",
        );

    const {
      data:
        createdData,
      error:
        createError,
    } =
      await admin.auth.admin.createUser(
        {
          email:
            internalEmail,

          password:
            internalPassword,

          email_confirm:
            true,

          user_metadata: {
            full_name:
              fullName,

            auth_mode:
              "collaborator_pin",
          },
        },
      );

    if (
      createError ||
      !createdData?.user
    ) {
      const message =
        createError?.message ??
        "create failed";

      console.error(
        "auth.createUser:",
        message,
      );

      return json(
        {
          error:
            message,
        },
        400,
      );
    }

    createdUserId =
      createdData.user.id;

    /*
     * --------------------------------------------------------
     * PROFILE
     * --------------------------------------------------------
     */

    const {
      error:
        profileError,
    } =
      await admin
        .from(
          "profiles",
        )
        .upsert(
          {
            id:
              createdUserId,

            full_name:
              fullName,

            branch_id:
              branchId,

            is_active:
              true,
          },
          {
            onConflict:
              "id",
          },
        );

    if (
      profileError
    ) {
      console.error(
        "profiles.upsert:",
        profileError.message,
      );

      const {
        error:
          rollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (
        rollbackError
      ) {
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

      createdUserId =
        null;

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
     * --------------------------------------------------------
     * ROL + SUCURSAL
     * --------------------------------------------------------
     *
     * IMPORTANTE:
     *
     * No hacemos INSERT directo a user_roles.
     *
     * Utilizamos el RPC existente.
     */

    const {
      error:
        accessError,
    } =
      await userClient.rpc(
        "admin_set_user_access",
        {
          _user_id:
            createdUserId,

          _role:
            role,

          _branch_id:
            branchId,

          _is_active:
            true,
        },
      );

    if (
      accessError
    ) {
      console.error(
        "admin_set_user_access:",
        accessError.message,
      );

      /*
       * Rollback de profile.
       */

      await admin
        .from(
          "profiles",
        )
        .delete()
        .eq(
          "id",
          createdUserId,
        );

      /*
       * Rollback de Auth.
       */

      const {
        error:
          authRollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (
        authRollbackError
      ) {
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

      createdUserId =
        null;

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
     * --------------------------------------------------------
     * PIN DEL COLABORADOR
     * --------------------------------------------------------
     *
     * El RPC existente se encarga del hash y validaciones.
     */

    const {
      error:
        pinError,
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

    if (
      pinError
    ) {
      console.error(
        "admin_set_collaborator_pin:",
        pinError.message,
      );

      /*
       * Rollback de credencial PIN.
       */

      await admin
        .from(
          "collaborator_pin_credentials",
        )
        .delete()
        .eq(
          "user_id",
          createdUserId,
        );

      /*
       * Rollback de rol.
       */

      await admin
        .from(
          "user_roles",
        )
        .delete()
        .eq(
          "user_id",
          createdUserId,
        );

      /*
       * Rollback de profile.
       */

      await admin
        .from(
          "profiles",
        )
        .delete()
        .eq(
          "id",
          createdUserId,
        );

      /*
       * Rollback de Auth.
       */

      const {
        error:
          authRollbackError,
      } =
        await admin.auth.admin.deleteUser(
          createdUserId,
        );

      if (
        authRollbackError
      ) {
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

      createdUserId =
        null;

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
     * --------------------------------------------------------
     * ÉXITO
     * --------------------------------------------------------
     */

    return json(
      {
        ok: true,

        user_id:
          createdUserId,

        full_name:
          fullName,

        role,

        branch_id:
          branchId,

        auth_mode:
          "collaborator_pin",
      },
      200,
    );
  } catch (error) {
    const message =
      errorMessage(
        error,
      );

    console.error(
      "admin-create-user:",
      message,
      error,
    );

    /*
     * --------------------------------------------------------
     * ROLLBACK DE EXCEPCIÓN
     * --------------------------------------------------------
     */

    if (
      createdUserId
    ) {
      try {
        const supabaseUrl =
          Deno.env.get(
            "SUPABASE_URL",
          );

        const serviceRoleKey =
          Deno.env.get(
            "SUPABASE_SERVICE_ROLE_KEY",
          );

        if (
          supabaseUrl &&
          serviceRoleKey
        ) {
          const admin =
            createClient(
              supabaseUrl,
              serviceRoleKey,
              {
                auth: {
                  autoRefreshToken:
                    false,
                  persistSession:
                    false,
                },
              },
            );

          await admin.auth.admin.deleteUser(
            createdUserId,
          );
        }
      } catch (
        rollbackError
      ) {
        console.error(
          "exception rollback:",
          errorMessage(
            rollbackError,
          ),
        );
      }
    }

    return json(
      {
        error:
          message ||
          "internal server error",
      },
      500,
    );
  }
});