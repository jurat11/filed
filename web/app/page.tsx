import Link from "next/link";
import { int } from "@/lib/format";
import { lcaYears, search } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 100);
  const [results, years] = await Promise.all([
    query.length >= 2 ? search(query) : Promise.resolve([]),
    lcaYears(),
  ]);
  const lastFull = years.filter((y) => y < Math.max(...years)).at(-1) ?? Math.max(...years);

  const presets = [
    {
      label: "Entry-level software in Virginia and DC",
      note: `Certified LCAs, Software engineering, wage level I or II, FY${lastFull}`,
      href: `/explore?role=Software+engineering&state=VA,DC&level=I,II&fy=${lastFull}`,
    },
    {
      label: "Finance roles, any state",
      note: `Certified LCAs in finance occupations, FY${lastFull}`,
      href: `/explore?role=Finance&fy=${lastFull}`,
    },
    {
      label: "Most USCIS initial approvals",
      note: "FY2023, the latest year USCIS publishes as a file",
      href: "/explore?sort=uscis",
    },
  ];

  return (
    <div>
      <h1 className="max-w-2xl text-3xl font-semibold tracking-tight">
        Which employers actually file H-1B paperwork for entry-level roles, and at what pay
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        Built only from Department of Labor LCA disclosure files (FY{Math.min(...years)} to FY
        {Math.max(...years)}) and the USCIS H-1B Employer Data Hub. Every number links to the file
        it came from.
      </p>

      <form action="/" className="mt-8 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search an employer, e.g. Capital One"
          aria-label="Employer name"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <button className="rounded-md bg-accent px-4 py-2 font-medium text-white dark:text-black">
          Search
        </button>
      </form>

      {query.length >= 2 && (
        <section className="mt-6">
          {results.length === 0 ? (
            <p className="text-muted">No employer matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line bg-surface">
              {results.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/employer/${r.slug}`}
                    className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-accent-soft"
                  >
                    <span>
                      {r.display_name}
                      <span className="ml-2 text-sm text-muted">{r.state}</span>
                      {!r.has_lca && (
                        <span className="ml-2 text-xs text-warn">USCIS only, no LCA match</span>
                      )}
                    </span>
                    <span className="num shrink-0 text-sm text-muted">
                      {int(r.certified_total)} certified LCAs
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Start here</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {presets.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              className="rounded-md border border-line bg-surface p-4 hover:border-accent"
            >
              <div className="font-medium">{p.label}</div>
              <div className="mt-1 text-sm text-muted">{p.note}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
