import { describe, expect, it } from "vitest";
import {
  csvCell,
  csvHeader,
  exploreQuery,
  exploreSql,
  parseExplore,
  toCsv,
  type ExploreRow,
} from "@/lib/explore";

const YEARS = [2023, 2024, 2025, 2026];
const DEFAULTS = {
  role: [],
  state: [],
  level: [],
  fy: "all",
  min: 0,
  hideDependent: false,
  hideCapExempt: false,
  sort: "certified",
  page: 1,
};

const INJECTIONS = [
  "'; DROP SCHEMA filed CASCADE; --",
  "1 OR 1=1",
  "VA' OR 'a'='a",
  "$1",
  "certified; DELETE FROM filed.employers",
  "\u0000",
  "../../etc/passwd",
  "<script>alert(1)</script>",
];

describe("parseExplore", () => {
  it("returns defaults for no params", () => {
    expect(parseExplore({}, YEARS)).toEqual(DEFAULTS);
  });

  it("accepts valid values, comma lists and repeated keys", () => {
    const p = parseExplore(
      {
        role: ["Software engineering", "Finance"],
        state: "va, dc,VA",
        level: "I,II",
        fy: "2025",
        min: "10",
        hide_dependent: "1",
        sort: "wage",
        page: "3",
      },
      YEARS,
    );
    expect(p).toEqual({
      role: ["Software engineering", "Finance"],
      state: ["VA", "DC"],
      level: ["I", "II"],
      fy: "2025",
      min: 10,
      hideDependent: true,
      hideCapExempt: false,
      sort: "wage",
      page: 3,
    });
  });

  it.each(INJECTIONS)("drops injection attempt %j in every param", (bad) => {
    const sp = Object.fromEntries(
      ["role", "state", "level", "fy", "min", "hide_dependent", "hide_cap_exempt", "sort", "page"].map((k) => [k, bad]),
    );
    expect(parseExplore(sp, YEARS)).toEqual(DEFAULTS);
  });

  it.each(["2019", "2030", "0000", "99999", "20 25", "2025.0", "-2025", "all2025"])(
    "rejects fiscal year %j that is not loaded or not a year",
    (fy) => {
      expect(parseExplore({ fy }, YEARS).fy).toBe("all");
    },
  );

  it("keeps a well-formed fiscal year when loaded years are unknown", () => {
    expect(parseExplore({ fy: "2025" }).fy).toBe("2025");
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "CERTIFIED", "", "wage "])(
    "falls back to the default for unknown sort key %j",
    (sort) => {
      expect(parseExplore({ sort }, YEARS).sort).toBe(sort.trim() === "wage" ? "wage" : "certified");
    },
  );

  it.each(["Infinity", "-5", "1e9", "NaN", "0x10", "12abc", "99999999999"])(
    "clamps or rejects min %j",
    (min) => {
      const got = parseExplore({ min }, YEARS).min;
      expect(Number.isInteger(got)).toBe(true);
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThanOrEqual(1_000_000_000);
    },
  );

  it("rejects unknown states, levels and roles", () => {
    const p = parseExplore({ state: "XX,V,VAX,??", level: "V,i,1", role: "software engineering" });
    expect(p.state).toEqual([]);
    expect(p.level).toEqual([]);
    expect(p.role).toEqual([]);
  });
});

describe("exploreSql", () => {
  it("binds every user value and splices none into the SQL text", () => {
    const p = parseExplore({
      role: "Finance",
      state: "VA",
      level: "I",
      fy: "2025",
      min: "7",
      sort: "name",
      hide_dependent: "1",
      hide_cap_exempt: "1",
    });
    const { text, values } = exploreSql(p, 50, 100);
    expect(values).toEqual([2025, ["Finance"], ["VA"], ["I"], 7, 50, 100]);
    for (const v of ["Finance", "'VA'", "2025"]) expect(text).not.toContain(v);
    expect(text).toContain("ORDER BY display_name ASC, e.display_name, e.slug");
    expect(text).toContain("e.h1b_dependent_latest IS NOT TRUE");
    expect(text).toContain("e.cap_exempt_rule IS NULL");
  });

  it("produces the same SQL text for hostile input as for none", () => {
    const clean = exploreSql(parseExplore({}), 50).text;
    for (const bad of INJECTIONS) {
      const sp = { role: bad, state: bad, level: bad, fy: bad, min: bad, sort: bad, page: bad };
      expect(exploreSql(parseExplore(sp), 50).text).toBe(clean);
    }
  });

  it("caps the limit at the export maximum", () => {
    const { values } = exploreSql(parseExplore({}), 1_000_000);
    expect(values.at(-2)).toBe(5000);
  });
});

describe("exploreQuery", () => {
  it("round-trips through parseExplore", () => {
    const p = parseExplore({ role: ["Finance", "Other"], state: "VA,DC", fy: "2024", sort: "uscis", page: "2" });
    expect(parseExplore(Object.fromEntries(new URLSearchParams(exploreQuery(p)).entries()))).toMatchObject({
      state: ["VA", "DC"],
      fy: "2024",
      sort: "uscis",
      page: 2,
    });
    const u = new URLSearchParams(exploreQuery(p));
    expect(parseExplore({ role: u.getAll("role") }).role).toEqual(["Finance", "Other"]);
  });
  it("leaves defaults out", () => {
    expect(exploreQuery(parseExplore({}))).toBe("");
  });
});

describe("CSV", () => {
  const row: ExploreRow = {
    slug: "acme",
    display_name: 'Acme, "The" Co',
    state: null,
    certified: 5,
    wage_rows: 0,
    avg_wage: null,
    uscis_initial_total: null,
    h1b_dependent_latest: null,
    cap_exempt_rule: null,
    total_rows: 1,
  };

  it("leaves missing values empty, never 0", () => {
    const lines = toCsv([row], [2023]).trim().split("\n");
    expect(lines[0]).toBe(csvHeader([2023]).join(","));
    expect(lines[1]).toBe('"Acme, ""The"" Co",,5,,0,,,,/employer/acme');
  });

  it("names the USCIS years in the header", () => {
    expect(csvHeader([2023, 2024])).toContain("uscis_initial_approvals_fy2023_fy2024");
    expect(csvHeader([])).toContain("uscis_initial_approvals_not_loaded");
  });

  it("neutralizes spreadsheet formulas in text but not numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
  });
});
