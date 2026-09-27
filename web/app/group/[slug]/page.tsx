import { Scroll } from "@/components/Scroll";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceTag } from "@/components/SourceTag";
import { Badge, PageHeader } from "@/components/ui";
import { int, n } from "@/lib/format";
import { group } from "@/lib/queries";

export const revalidate = 86400;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = await group((await params).slug);
  return g
    ? {
        title: `${g.members[0].group_name}: related entities`,
        description: `Separate FEIN employers grouped under ${g.members[0].group_name} by a reviewed parent map. Each keeps its own figures.`,
      }
    : { title: "Group not found" };
}

/** A reviewed group of legal entities (docs/decisions.md D31). Members stay separate. */
export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const g = await group((await params).slug);
  if (!g) notFound();
  const { members, years } = g;
  const fys = [...new Set(years.map((y) => n(y.fiscal_year)!))].sort();
  const cell = (id: number, fy: number) => years.find((y) => y.employer_id === id && n(y.fiscal_year) === fy);
  const head = members[0];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Related entities, reviewed parent map" title={head.group_name}>
        <p className="mb-3"><Badge tone="accent" icon="check">Reviewed {head.reviewed_on}</Badge></p>
        <p>
        These are separate employers, each with its own federal tax ID (FEIN). Filed keeps their
        figures apart; this page only lists them together because a person reviewed evidence
        that they belong to one parent:{" "}
        <a href={head.evidence_url} className="underline">
          evidence
        </a>{" "}
        (reviewed {head.reviewed_on}).
        </p>
      </PageHeader>

      <div className="card overflow-hidden">
      <Scroll label="Members">
        <table className="data-table num w-full min-w-[640px] text-sm">
          <caption className="sr-only">Certified LCAs per member and fiscal year</caption>
          <thead className="text-left">
            <tr>
              <th scope="col">Employer (FEIN)</th>
              {fys.map((fy) => (
                <th key={fy} scope="col" className="text-right">FY{fy} certified</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.slug}>
                <td>
                  <Link href={`/employer/${m.slug}`} className="font-medium text-accent hover:underline">{m.display_name}</Link>
                  <span className="ml-2 font-mono text-xs text-muted">{m.fein}</span>
                </td>
                {fys.map((fy) => {
                  const y = cell(m.employer_id, fy);
                  return (
                    <td key={fy} className="text-right">
                      {y ? int(y.certified) : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-surface-2">
              <td className="text-muted">Sum of the separate employers above</td>
              {fys.map((fy) => (
                <td key={fy} className="text-right text-muted">
                  {int(years.filter((y) => n(y.fiscal_year) === fy).reduce((t, y) => t + (n(y.certified) ?? 0), 0))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Scroll>
      </div>
      <div className="flex flex-wrap gap-2">
        {fys.map((fy) => {
          const ys = years.filter((y) => n(y.fiscal_year) === fy);
          return <SourceTag key={fy} file={String(ys[0].source_file)} rows={ys.reduce((t, y) => t + (n(y.filed) ?? 0), 0)} />;
        })}
      </div>
      <p className="text-xs text-muted">
        A dash means the employer filed no LCA that year. The sum is a sum of separate employers,
        not a merged employer; every other figure on Filed stays at the FEIN level.
      </p>
    </div>
  );
}
