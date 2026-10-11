
/**
 * Genera un código de producto único, compuesto solo por números.
 * Verifica la unicidad en products.barcode antes de devolverlo.
 *
 * Compatible con los productos existentes:
 * - No modifica códigos de barras guardados.
 * - No cambia tablas, columnas ni RPC.
 * - Conserva el límite de 4 a 10 caracteres.
 */
import { supabase } from "@/integrations/supabase/client";

const ALPHABET = "0123456789";
const CODE_LEN = 10;
const MAX_ATTEMPTS = 40;

function randomCode(length = CODE_LEN): string {
  let out = "";
  const bytes = new Uint8Array(length);

  crypto.getRandomValues(bytes);

  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }

  return out;
}

export async function generateUniqueBarcode(
  length = CODE_LEN,
): Promise<string> {
  if (!Number.isInteger(length) || length < 4 || length > 10) {
    throw new Error("El código debe tener entre 4 y 10 dígitos");
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode(length);

    const { data, error } = await supabase
      .from("products")
      .select("id")
      .eq("barcode", code)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return code;
    }
  }

  throw new Error(
    "No se pudo generar un código único. Intenta de nuevo.",
  );
}
