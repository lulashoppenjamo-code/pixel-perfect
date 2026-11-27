
/** Persist only denominations that were actually counted with a positive quantity. */
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

  for (const key of CLOSING_DENOMINATION_KEYS) {
    const raw = (counts[key] ?? "").trim();

    // Ignore denominations that were left blank.
    if (raw === "") continue;

    const quantity = Number(raw);

    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error(
        "Las cantidades de billetes y monedas deben ser enteros mayores o iguales a 0.",
      );
    }

    // Save only denominations with a quantity greater than zero.
    if (quantity > 0) {
      result[key] = quantity;
    }
  }

  return result;
}

/** Never fabricate counts for old cuts, absent keys, or zero values. */
export function deserializeClosingDenominations(
  value: unknown,
): Record<string, string> {
  const result: Record<string, string> = {};

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return result;
  }

  for (const key of CLOSING_DENOMINATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

    const quantity: unknown = (value as Record<string, unknown>)[key];

    if (
      typeof quantity === "number" &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
    ) {
      result[key] = String(quantity);
    }
  }

  return result;
}
