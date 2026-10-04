const DEVICE_SECRET_KEY =
  "lula_shop_os.pos_device_secret";

const DEVICE_NAME_KEY =
  "lula_shop_os.pos_device_name";

const DEVICE_AUTHORIZED_KEY =
  "lula_shop_os.pos_device_authorized";

function bytesToBase64Url(
  bytes: Uint8Array,
): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Genera un secreto criptográficamente seguro
 * para identificar/autenticar este dispositivo POS.
 *
 * El secreto nunca se muestra al usuario.
 */
export function generateDeviceSecret(): string {
  const bytes =
    new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return bytesToBase64Url(bytes);
}

/**
 * Obtiene el secreto existente.
 *
 * Si todavía no existe, genera uno nuevo y
 * lo guarda únicamente en este dispositivo.
 */
export function getOrCreateDeviceSecret(): string {
  const existing =
    localStorage.getItem(
      DEVICE_SECRET_KEY,
    );

  if (existing) {
    return existing;
  }

  const secret =
    generateDeviceSecret();

  localStorage.setItem(
    DEVICE_SECRET_KEY,
    secret,
  );

  return secret;
}

/**
 * Obtiene el secreto sin generarlo.
 */
export function getDeviceSecret():
  | string
  | null {
  return localStorage.getItem(
    DEVICE_SECRET_KEY,
  );
}

/**
 * Elimina las credenciales locales del dispositivo.
 *
 * Esto NO revoca el dispositivo en Supabase.
 * Para revocarlo realmente debe utilizarse
 * admin_revoke_pos_device().
 */
export function clearDeviceSecret(): void {
  localStorage.removeItem(
    DEVICE_SECRET_KEY,
  );

  localStorage.removeItem(
    DEVICE_AUTHORIZED_KEY,
  );
}

/**
 * Guarda el nombre amigable de la tablet.
 */
export function setDeviceName(
  name: string,
): void {
  const cleanName =
    name.trim();

  if (!cleanName) {
    localStorage.removeItem(
      DEVICE_NAME_KEY,
    );

    return;
  }

  localStorage.setItem(
    DEVICE_NAME_KEY,
    cleanName,
  );
}

/**
 * Obtiene el nombre local del dispositivo.
 */
export function getDeviceName():
  | string
  | null {
  return localStorage.getItem(
    DEVICE_NAME_KEY,
  );
}

/**
 * Marca localmente que el secreto de este
 * dispositivo ya fue autorizado por el dueño.
 */
export function setDeviceAuthorized(
  authorized: boolean,
): void {
  if (authorized) {
    localStorage.setItem(
      DEVICE_AUTHORIZED_KEY,
      "true",
    );
  } else {
    localStorage.removeItem(
      DEVICE_AUTHORIZED_KEY,
    );
  }
}

/**
 * Indica si este dispositivo fue marcado
 * localmente como autorizado.
 *
 * Esto es solamente una ayuda de UI.
 * La autorización real siempre la decide
 * Supabase mediante verify_collaborator_pin().
 */
export function isDeviceMarkedAuthorized(): boolean {
  return (
    localStorage.getItem(
      DEVICE_AUTHORIZED_KEY,
    ) === "true"
  );
}