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

import { createClient } from "npm:@supabase/supabase-js@2";

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

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
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

  return String(
    error ?? "",
  );
}

Deno.serve(async (req) => {
  /*
   * ==========================================================
   * CORS
   * ==========================================================
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
   * ==========================================================
   * MÉTODO
   * ==========================================================
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
     * ========================================================
     * VARIABLES SUPABASE
     * ========================================================
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
      !serviceRoleKey
    ) {
      console.error(
        "admin-create-user: missing required Supabase environment variables",
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
     * ========================================================
     * AUTENTICACIÓN DEL ADMINISTRADOR
     * ========================================================
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
     * Para ejecutar RPCs que dependen de auth.uid()
     * necesitamos conservar el JWT del administrador.
     *
     * Si SUPABASE_ANON_KEY no está disponible, usamos
     * el publishable key enviado por el cliente cuando
     * exista.
     */

    const callerKey =
      anonKey ||
      req.headers.get(
        "apikey",
      );

    if (!callerKey) {
      console.error(
        "admin-create-user: missing caller key",
      );

      return json(
        {
          error:
            "server misconfigured",
        },
        500,
      );
    }

    const userClient =
      createClient(
        supabaseUrl,
        callerKey,
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
     * ========================================================
     * VERIFICAR USUARIO
     * ========================================================
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
        "admin-create-user getUser:",
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
     * ========================================================
     * AUTORIZACIÓN
     * ========================================================
     */

    let callerCanManage =
      false;

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
        "admin-create-user is_admin:",
        adminCheckError.message,
      );
    }

    if (
      callerIsAdmin === true
    ) {
      callerCanManage =
        true;
    }

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
          "admin-create-user has_permission:",
          permissionError.message,
        );
      }

      if (
        hasManage === true
      ) {
        callerCanManage =
          true;
      }
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
     * ========================================================
     * LEER BODY
     * ========================================================
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
     * ========================================================
     * DATOS
     * ========================================================
     */

    const fullName =
      String(
        body.full_name ??
          "",
      ).trim();

    const pin =
      String(
        body.pin ??
          "",
      ).trim();

    const role =
      String(
        body.role ??
          "staff",
      ).trim();

    const rawBranchId =
      body.branch_id;

    const branchId =
      rawBranchId !== null &&
      rawBranchId !== undefined &&
      String(
        rawBranchId,
      ).trim() !== ""
        ? String(
            rawBranchId,
          ).trim()
        : null;

    /*
     * ========================================================
     * VALIDACIONES
     * ========================================================
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
     * El owner no utiliza este flujo.
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
     * ========================================================
     * CLIENTE SERVICE ROLE
     * ========================================================
     *
     * Este cliente nunca sale de la Edge Function.
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
     * ========================================================
     * CREAR USUARIO AUTH
     * ========================================================
     *
     * IMPORTANTE:
     *
     * Esta contraseña técnica NO es el PIN.
     *
     * Tiene 32 caracteres y está muy por debajo del límite
     * de bcrypt/Supabase Auth de 72 caracteres.
     */

    const internalId =
      crypto.randomUUID();

    const internalEmail =
      `collaborator_${internalId}@auth.lulashop.local`;

    const internalPassword =
      crypto
        .randomUUID()
        .replaceAll(
          "-",
          "",
        );

    console.log(
      "admin-create-user: creating auth user",
      {
        internalEmail,
        passwordLength:
          internalPassword.length,
        role,
        branchId,
      },
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
        createError?.message ||
        "create failed";

      console.error(
        "admin-create-user auth.createUser:",
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

    console.log(
      "admin-create-user: auth user created",
      {
        userId:
          createdUserId,
      },
    );

    /*
     * ========================================================
     * CREAR / ACTUALIZAR PROFILE
     * ========================================================
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
        "admin-create-user profiles.upsert:",
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
     * ========================================================
     * ASIGNAR ROL + SUCURSAL
     * ========================================================
     *
     * Se utiliza el RPC existente.
     * No se hace INSERT manual en user_roles.
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
        "admin-create-user admin_set_user_access:",
        accessError.message,
      );

      await admin
        .from(
          "profiles",
        )
        .delete()
        .eq(
          "id",
          createdUserId,
        );

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
     * ========================================================
     * CONFIGURAR PIN
     * ========================================================
     *
     * El RPC existente:
     * - valida que sean 4 dígitos
     * - genera bcrypt
     * - guarda únicamente el hash
     * - reinicia intentos fallidos
     *
     * El PIN nunca se guarda en texto plano.
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
        "admin-create-user admin_set_collaborator_pin:",
        pinError.message,
      );

      /*
       * Limpiar credencial PIN si llegó a crearse.
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
       * Limpiar rol.
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
       * Limpiar profile.
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
       * Eliminar usuario Auth.
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
     * ========================================================
     * ÉXITO
     * ========================================================
     */

    console.log(
      "admin-create-user: collaborator created successfully",
      {
        userId:
          createdUserId,
        role,
        branchId,
      },
    );

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
  } catch (
    error
  ) {
    const message =
      getErrorMessage(
        error,
      );

    console.error(
      "admin-create-user runtime error:",
      message,
      error,
    );

    /*
     * ========================================================
     * ROLLBACK GENERAL
     * ========================================================
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
          const rollbackAdmin =
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
           * Limpiar credencial PIN.
           */

          await rollbackAdmin
            .from(
              "collaborator_pin_credentials",
            )
            .delete()
            .eq(
              "user_id",
              createdUserId,
            );

          /*
           * Limpiar roles.
           */

          await rollbackAdmin
            .from(
              "user_roles",
            )
            .delete()
            .eq(
              "user_id",
              createdUserId,
            );

          /*
           * Limpiar profile.
           */

          await rollbackAdmin
            .from(
              "profiles",
            )
            .delete()
            .eq(
              "id",
              createdUserId,
            );

          /*
           * Eliminar Auth.
           */

          await rollbackAdmin.auth.admin.deleteUser(
            createdUserId,
          );
        }
      } catch (
        rollbackError
      ) {
        console.error(
          "admin-create-user rollback error:",
          getErrorMessage(
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