import { describe, expect, it } from "vitest";
import { REQUIRED, verdict } from "../scripts/check-schema.mjs";

describe("check-schema verdict", () => {
  it("passes when the database matches", () => {
    expect(verdict(REQUIRED).ok).toBe(true);
  });

  it("fails on an older load, or one with no version", () => {
    expect(verdict(REQUIRED - 1).ok).toBe(false);
    expect(verdict(null).ok).toBe(false);
    expect(verdict(Number("x")).ok).toBe(false);
    expect(verdict(null).message).toContain("uv run filed all");
  });

  it("passes a newer load and says so", () => {
    const v = verdict(REQUIRED + 1);
    expect(v.ok).toBe(true);
    expect(v.message).toContain("newer");
  });
});
