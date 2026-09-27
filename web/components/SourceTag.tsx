import Link from "next/link";
import { int, sourceLabel } from "@/lib/format";

/** Where a figure comes from: the file (or a written label) and the rows behind it. */
export function SourceTag({ file, label, rows }: { file?: string; label?: string; rows: unknown }) {
  return (
    <Link
      href="/sources"
      className="inline-block rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-ink"
      title="Where this number comes from"
    >
      {label ?? sourceLabel(file ?? "")}, {int(rows)} rows
    </Link>
  );
}
