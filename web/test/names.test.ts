import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeName } from "@/lib/names";

const cases: { raw: string; norm: string }[] = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/normalize_cases.json", import.meta.url), "utf8"),
);

describe("normalizeName matches etl/names.py", () => {
  it.each(cases)("$raw -> $norm", ({ raw, norm }) => {
    expect(normalizeName(raw)).toBe(norm);
  });
  it("handles null", () => {
    expect(normalizeName(null)).toBe("");
  });
});
