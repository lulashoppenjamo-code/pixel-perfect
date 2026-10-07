/**
 * Genera un código de producto único (máx. 10 caracteres).
 * Verifica unicidad en products.barcode antes de devolverlo.
 */
import { supabase } from "@/integrations/supabase/client";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I para legibilidad
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
  if (length < 4 || length > 10) {
    throw new Error("El código debe tener entre 4 y 10 caracteres");
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