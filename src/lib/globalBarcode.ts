/**
 * Lector de código de barras tipo pistola (keyboard wedge).
 * Captura el código en cualquier pantalla y lo entrega al POS.
 */

const PENDING_KEY = "lula-pending-barcode";
const OPEN_POS_KEY = "lula-open-pos";
export const BARCODE_EVENT = "lula-barcode-scan";

const MIN_CODE_LENGTH = 3;
/** Si entre teclas pasan más de esto, se considera tipeo humano y se reinicia el buffer */
const MAX_GAP_MS = 80;

let buffer = "";
let lastKeyAt = 0;
let listening = false;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const input = target as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    // Permitir captura global salvo campos de contraseña / largos de formulario
    if (type === "password" || type === "email" || type === "number") {
      return true;
    }
    // Si el input es el buscador del POS, también dejamos que el flujo global actúe
    // (el POS escuchará el evento y agregará el producto).
    return false;
  }
  if (target.isContentEditable) return true;
  return false;
}

export function setPendingBarcode(code: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, code);
    sessionStorage.setItem(OPEN_POS_KEY, "1");
  } catch {
    // ignore
  }
}

export function consumePendingBarcode(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_KEY);
    if (code) sessionStorage.removeItem(PENDING_KEY);
    return code;
  } catch {
    return null;
  }
}

export function consumeOpenPosFlag(): boolean {
  try {
    const v = sessionStorage.getItem(OPEN_POS_KEY);
    if (v) sessionStorage.removeItem(OPEN_POS_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export function dispatchBarcode(code: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BARCODE_EVENT, { detail: { code } }),
  );
}

/**
 * Activa el listener global del lector USB/Bluetooth (emula teclado).
 * onScan: se llama con el código completo (sin Enter).
 */
export function startGlobalBarcodeListener(
  onScan: (code: string) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  if (listening) {
    // Un solo listener activo; el caller debe ser el shell
  }
  listening = true;

  const onKeyDown = (event: KeyboardEvent) => {
    // No interferir con atajos del sistema
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (isEditableTarget(event.target) && event.key !== "Enter") {
      // En campos de texto normales no acumulamos (evita robar escritura lenta)
      // Los lectores son tan rápidos que si el foco está en body/botón sí capturamos.
      const t = event.target as HTMLElement;
      if (t.tagName === "TEXTAREA") return;
      if (t.tagName === "INPUT") {
        const type = ((t as HTMLInputElement).type || "text").toLowerCase();
        if (type === "password" || type === "email") return;
      }
    }

    const now = Date.now();

    if (event.key === "Enter") {
      const code = buffer.trim();
      buffer = "";
      lastKeyAt = 0;
      if (code.length >= MIN_CODE_LENGTH) {
        event.preventDefault();
        event.stopPropagation();
        onScan(code);
      }
      return;
    }

    if (event.key.length !== 1) return;

    if (lastKeyAt && now - lastKeyAt > MAX_GAP_MS) {
      buffer = "";
    }

    buffer += event.key;
    lastKeyAt = now;
  };

  window.addEventListener("keydown", onKeyDown, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    listening = false;
    buffer = "";
    lastKeyAt = 0;
  };
}
