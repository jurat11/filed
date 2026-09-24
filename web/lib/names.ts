/**
 * Port of etl/names.py normalize_name, used to match search queries the way the ETL
 * matches employer names. Both are tested on tests/fixtures/normalize_cases.json.
 */

const SUFFIXES = new Set([
  "INC", "LLC", "LLP", "CORP", "CORPORATION", "CO", "LTD", "LP", "PLLC",
  "INCORPORATED", "LIMITED", "COMPANY", "PC",
]);

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  s = s.toUpperCase();
  s = s.replace(/\s(?:D\s*\/\s*B\s*\/\s*A|DBA)\b.*$/, "");
  s = s.replace(/[&+]/g, " ");
  s = s.replace(/[.'’`]/g, "");
  s = s.replace(/[^A-Z0-9 ]+/g, " ");
  let tokens = s.replace(/\s+/g, " ").trim().split(" ").filter((t) => t !== "AND");
  if (tokens.length === 0) tokens = ["AND"];
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length > 1 && tokens[0] === "THE") tokens.shift();
  return tokens.filter(Boolean).join(" ");
}
