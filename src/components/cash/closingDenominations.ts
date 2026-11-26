/** Persisted counts use numeric JSON values; blank capture remains an empty object. */
export const CLOSING_DENOMINATION_KEYS = [
  "1000",
  "500",
  "200",
  "100",
  "50",
  "20",
  "10",
  "5",
  "2",
  "1",
  "0.5",
] as const;

export function serializeClosingDenominations(
  counts: Record<string, string>,
): Record<string, number> {
  const result: Record<string, number> = {};
  let captured = false;
  for (const key of CLOSING_DENOMINATION_KEYS) {
    const raw = (counts[key] ?? "").trim();
    const quantity = raw === "" ? 0 : Number(raw);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(
        "Las cantidades de billetes y monedas deben ser enteros mayores o iguales a 0.",
      );
    }
    if (raw !== "") captured = true;
    result[key] = quantity;
  }
  return captured ? result : {};
}

/** Never fabricate counts for old cuts, absent keys, or invalid stored values. */
export function deserializeClosingDenominations(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return result;
  for (const key of CLOSING_DENOMINATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const quantity: unknown = (value as Record<string, unknown>)[key];
    if (typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity >= 0) {
      result[key] = String(quantity);
    }
  }
  return result;
}
