export const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function int(v: unknown): string {
  const x = n(v);
  return x === null || Number.isNaN(x) ? "–" : x.toLocaleString("en-US");
}

export function usd(v: unknown): string {
  const x = n(v);
  return x === null || Number.isNaN(x) ? "–" : "$" + Math.round(x).toLocaleString("en-US");
}

export function pct(part: unknown, whole: unknown): string {
  const p = n(part) ?? 0;
  const w = n(whole) ?? 0;
  return w > 0 ? `${Math.round((100 * p) / w)}%` : "–";
}

/** "LCA_Disclosure_Data_FY2025_Q1-Q4" -> "DOL LCA FY2025 Q1-Q4". */
export function sourceLabel(file: string): string {
  if (file.includes(" + ")) return file.split(" + ").map(sourceLabel).join(" + ").replace(/ \+ DOL LCA/g, " +");
  const m = file.match(/FY_?(\d{4})_(Q[\d-Q]+)/);
  if (file.startsWith("h1b_datahubexport")) return `USCIS Data Hub FY${file.match(/\d{4}/)?.[0]}`;
  return m ? `DOL LCA FY${m[1]} ${m[2]}` : file;
}
