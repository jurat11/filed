import type { Metadata } from "next";
import Link from "next/link";
import { int, usd } from "@/lib/format";
import { explore, LEVELS, lcaYears, parseExplore, ROLE_GROUPS } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore" };

type SP = Record<string, string | string[] | undefined>;

function qs(sp: SP, patch: Record<string, string>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of [].concat((v ?? []) as never)) u.append(k, x);
  for (const [k, v] of Object.entries(patch)) u.set(k, v);
  return u.toString();
}

export default async function Explore({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const p = parseExplore(sp);
  const [rows, years] = await Promise.all([explore(p), lcaYears()]);
  const box = "rounded-md border border-line bg-surface px-2 py-1.5";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Explore employers</h1>
      <p className="mt-1 text-sm text-muted">
        Certified LCAs matching every filter, counted at the first worksite on each LCA.
      </p>

      <form action="/explore" className="mt-6 grid gap-4 rounded-md border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <fieldset>
          <legend className="text-sm font-medium">Role group</legend>
          {ROLE_GROUPS.map((r) => (
            <label key={r} className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" name="role" value={r} defaultChecked={p.role.includes(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <div className="space-y-3">
          <fieldset>
            <legend className="text-sm font-medium">Wage level</legend>
            <div className="mt-1 flex gap-3">
              {LEVELS.map((l) => (
                <label key={l} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="level" value={l} defaultChecked={p.level.includes(l)} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-medium">
            Worksite states
            <input name="state" defaultValue={p.state.join(",")} placeholder="VA,DC" className={`${box} mt-1 block w-full font-normal`} />
          </label>
          <label className="block text-sm font-medium">
            Fiscal year
            <select name="fy" defaultValue={p.fy} className={`${box} mt-1 block w-full font-normal`}>
              <option value="all">All loaded years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  FY{y}
                  {y === Math.max(...years) ? " (Oct to Jun)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Minimum certified LCAs
            <input name="min" type="number" min={0} defaultValue={p.min || ""} className={`${box} mt-1 block w-full font-normal`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="hide_dependent" value="1" defaultChecked={p.hideDependent} />
            Hide H-1B dependent employers
          </label>
          <input type="hidden" name="sort" value={p.sort} />
          <div className="flex gap-2">
            <button className="rounded-md bg-accent px-4 py-2 font-medium text-white dark:text-black">Apply</button>
            <a href={`/explore/export?${qs(sp, {})}`} className="rounded-md border border-line px-4 py-2">
              Download CSV
            </a>
          </div>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="num w-full min-w-[640px] text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              {[
                ["name", "Employer"],
                ["certified", "Certified LCAs"],
                ["wage", "Mean offered wage"],
                ["uscis", "USCIS initial approvals, FY2023"],
              ].map(([k, label]) => (
                <th key={k} className={`py-2 font-normal ${k === "name" ? "" : "text-right"}`}>
                  <Link href={`/explore?${qs(sp, { sort: k })}`} className={p.sort === k ? "text-ink underline" : "hover:text-ink"}>
                    {label}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-line">
                <td className="py-2">
                  <Link href={`/employer/${r.slug}`} className="hover:underline">{r.display_name}</Link>
                  <span className="ml-2 text-xs text-muted">{r.state}</span>
                  {r.h1b_dependent_latest && <span className="ml-2 text-xs text-muted">dependent</span>}
                </td>
                <td className="text-right">{int(r.certified)}</td>
                <td className="text-right">{usd(r.avg_wage)}</td>
                <td className="text-right">{int(r.uscis_initial_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mt-4 text-muted">No employers match these filters.</p>}
        {rows.length === 200 && <p className="mt-2 text-xs text-muted">Showing the first 200. The CSV has up to 5,000.</p>}
      </div>
      <p className="mt-4 text-xs text-muted">
        Source: DOL LCA disclosure files, certified cases only; mean wage over certified full-time
        LCAs with a valid annual wage. <Link href="/sources" className="underline">Sources</Link>
      </p>
    </div>
  );
}
