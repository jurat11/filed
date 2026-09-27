/** Number from a database value. Missing (null, undefined, "" or not a number) is null,
 * never 0, so a missing figure can't be displayed as zero. */
export const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Shown in place of a missing number. */
export const MISSING = "–";

export function int(v: unknown): string {
  const x = n(v);
  return x === null ? MISSING : x.toLocaleString("en-US");
}

export function usd(v: unknown): string {
  const x = n(v);
  return x === null ? MISSING : "$" + Math.round(x).toLocaleString("en-US");
}

/** part / whole as a whole percentage. Missing when either side is missing or whole is 0. */
export function pct(part: unknown, whole: unknown): string {
  const p = n(part);
  const w = n(whole);
  return p === null || w === null || w <= 0 ? MISSING : `${Math.round((100 * p) / w)}%`;
}

/** "LCA_Disclosure_Data_FY2025_Q1-Q4" -> "DOL LCA FY2025 Q1-Q4". */
export function sourceLabel(file: string): string {
  if (file.includes(" + ")) return file.split(" + ").map(sourceLabel).join(" + ").replace(/ \+ DOL LCA/g, " +");
  if (file.startsWith("h1b_datahubexport") || file.startsWith("uscis_hub"))
    return `USCIS Data Hub FY${file.match(/\d{4}/)?.[0]}`;
  const m = file.match(/FY_?(\d{4})_(Q[\d-Q]+)/);
  return m ? `DOL LCA FY${m[1]} ${m[2]}` : file;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Last day covered by a DOL release: fiscal year FY runs October 1 (FY-1) to
 * September 30 (FY), so Q1 ends December 31 of FY-1 and Q4 ends September 30 of FY.
 */
export function quarterEnd(fy: number, quarter: number): string {
  const [m, d, y] = [
    [11, 31, fy - 1],
    [2, 31, fy],
    [5, 30, fy],
    [8, 30, fy],
  ][Math.min(Math.max(quarter, 1), 4) - 1];
  return `${MONTHS[m]} ${d}, ${y}`;
}

/** 1234567 -> "1.2M", 12900 -> "12.9K": for large standalone figures. */
export function compact(v: unknown): string {
  const x = n(v);
  if (x === null) return MISSING;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(x);
}
