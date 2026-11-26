import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CLOSING_DENOMINATION_KEYS,
  deserializeClosingDenominations,
  serializeClosingDenominations,
} from "./closingDenominations";

test("persists exactly the eleven requested keys with nonnegative integer numeric values", () => {
  expect(serializeClosingDenominations({ "500": "2", "0.5": "3" })).toEqual({
    "1000": 0,
    "500": 2,
    "200": 0,
    "100": 0,
    "50": 0,
    "20": 0,
    "10": 0,
    "5": 0,
    "2": 0,
    "1": 0,
    "0.5": 3,
  });
});

test("distinguishes a blank breakdown from an explicitly captured zero", () => {
  expect(serializeClosingDenominations({})).toEqual({});
  const zero = serializeClosingDenominations({ "1000": "0" });
  expect(Object.keys(zero).sort()).toEqual([...CLOSING_DENOMINATION_KEYS].sort());
  expect(Object.values(zero)).toEqual(Array(11).fill(0));
  expect(deserializeClosingDenominations(zero)["1000"]).toBe("0");
});

test("rejects negative, fractional, nonfinite and unsafe capture before sending it", () => {
  for (const quantity of ["-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    expect(() => serializeClosingDenominations({ "20": quantity })).toThrow();
  }
});

test("historical JSON roundtrips numeric counts to ticket strings without inventing counts", () => {
  const saved = serializeClosingDenominations({ "1000": "1", "5": "4", "0.5": "2" });
  const stored: unknown = JSON.parse(JSON.stringify(saved));
  expect(serializeClosingDenominations(deserializeClosingDenominations(stored))).toEqual(saved);
  for (const absent of [null, undefined, {}, [], "invalid"]) {
    expect(deserializeClosingDenominations(absent)).toEqual({});
  }
  expect(deserializeClosingDenominations({ "500": 2, "20": -1, "10": "3", "5": 0.5 })).toEqual({
    "500": "2",
  });
});

test("pending SQL keeps the exact existing close body and saves counts in the same update", () => {
  const original = readFileSync(
    new URL(
      "../../../drizzle/migrations/0001_cash_session_denominations_and_close_rpc.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const pending = readFileSync(
    new URL("../../../supabase/pending-close-cash-denominations.sql", import.meta.url),
    "utf8",
  );
  const body = (sql: string) => sql.split("AS $function$\n")[1]?.split("\n$function$;")[0];
  const validation =
    "  IF jsonb_typeof(COALESCE(_closing_denominations, '{}'::jsonb)) <> 'object' THEN\n    RAISE EXCEPTION 'invalid closing denominations: expected JSON object';\n  END IF;\n\n";
  const originalBody = body(original);
  expect(originalBody).toBeDefined();
  expect(
    body(pending)
      ?.replace(validation, "")
      .replace(
        "      closing_denominations = COALESCE(_closing_denominations, '{}'::jsonb),\n",
        "",
      ),
  ).toBe(originalBody);
  expect(pending.match(/UPDATE public\.cash_sessions/g)).toHaveLength(1);
  expect(pending).toContain("_closing_denominations jsonb\n)");
  expect(pending).not.toContain("DEFAULT");
  expect(pending).toContain("DROP FUNCTION public.close_cash_session(uuid, numeric);");
  expect(pending).toContain(
    "REVOKE ALL ON FUNCTION public.close_cash_session(uuid, numeric, jsonb) FROM PUBLIC, anon;",
  );
  expect(pending).toContain(
    "GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric, jsonb) TO authenticated, service_role;",
  );
});
