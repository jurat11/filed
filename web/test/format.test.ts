import { describe, expect, it } from "vitest";
import { int, MISSING, n, pct, sourceLabel, usd } from "@/lib/format";

describe("n", () => {
  it.each([null, undefined, "", "abc", NaN, Infinity, true])("%s is missing, not 0", (v) => {
    expect(n(v)).toBeNull();
  });
  it("parses numeric strings from Postgres", () => {
    expect(n("123456.00")).toBe(123456);
    expect(n(0)).toBe(0);
    expect(n("0")).toBe(0);
  });
});

describe("int and usd", () => {
  it("formats numbers", () => {
    expect(int(1234567)).toBe("1,234,567");
    expect(int("0")).toBe("0");
    expect(usd(98765.4)).toBe("$98,765");
    expect(usd("120000")).toBe("$120,000");
  });
  it.each([null, undefined, "", "n/a"])("shows %s as missing", (v) => {
    expect(int(v)).toBe(MISSING);
    expect(usd(v)).toBe(MISSING);
  });
});

describe("pct", () => {
  it("rounds to a whole percent", () => {
    expect(pct(1, 3)).toBe("33%");
    expect(pct(0, 10)).toBe("0%");
    expect(pct("5", "10")).toBe("50%");
  });
  it("is missing when a side is missing or the whole is 0", () => {
    expect(pct(null, 10)).toBe(MISSING);
    expect(pct(5, null)).toBe(MISSING);
    expect(pct(0, 0)).toBe(MISSING);
  });
});

describe("sourceLabel", () => {
  it.each([
    ["LCA_Disclosure_Data_FY2025_Q1-Q4", "DOL LCA FY2025 Q1-Q4"],
    ["LCA_Disclosure_Data_FY2026_Q3.xlsx", "DOL LCA FY2026 Q3"],
    ["LCA_Worksites_FY_2026_Q3.xlsx", "DOL LCA FY2026 Q3"],
    ["h1b_datahubexport-2023.csv", "USCIS Data Hub FY2023"],
    ["uscis_hub_FY2024.csv", "USCIS Data Hub FY2024"],
    [
      "LCA_Disclosure_Data_FY2025_Q1-Q4 + LCA_Disclosure_Data_FY2026_Q3.xlsx",
      "DOL LCA FY2025 Q1-Q4 + FY2026 Q3",
    ],
    ["something_else.csv", "something_else.csv"],
  ])("%s -> %s", (file, label) => {
    expect(sourceLabel(file)).toBe(label);
  });
});
