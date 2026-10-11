/**
 * Genera un código de producto único, compuesto solo por números.
 * Verifica unicidad en products.barcode y, si existe la columna,
 * en product_variants.barcode.
 *
 * - No modifica códigos ya guardados.
 * - No cambia tablas ni RPC.
 * - Longitud permitida: 4 a 10 dígitos.
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

async function barcodeExists(code: string): Promise<boolean> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("barcode", code)
    .maybeSingle();

  if (productError) throw productError;
  if (product) return true;

  // Variantes (columna barcode de la migración). Si la columna aún no existe, se ignora.
  try {
    const { data: variant, error: variantError } = await (supabase as any)
      .from("product_variants")
      .select("id")
      .eq("barcode", code)
      .maybeSingle();

    if (variantError) {
      const msg = String(variantError.message ?? variantError);
      if (
        msg.includes("barcode") &&
        (msg.includes("does not exist") || msg.includes("column"))
      ) {
        return false;
      }
      throw variantError;
    }

    if (variant) return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("barcode") && msg.includes("does not exist")) {
      return false;
    }
    throw err;
  }

  return false;
}

export async function generateUniqueBarcode(
  length = CODE_LEN,
): Promise<string> {
  if (!Number.isInteger(length) || length < 4 || length > 10) {
    throw new Error("El código debe tener entre 4 y 10 dígitos");
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode(length);
    const exists = await barcodeExists(code);
    if (!exists) return code;
  }

  throw new Error("No se pudo generar un código único. Intenta de nuevo.");
}
