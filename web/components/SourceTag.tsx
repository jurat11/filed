import Link from "next/link";
import { int, sourceLabel } from "@/lib/format";

/** Where a figure comes from, set like a footnote: the file (or a written label) and the
 * rows behind it. */
export function SourceTag({ file, label, rows }: { file?: string; label?: string; rows: unknown }) {
  return (
    <Link
      href="/sources"
      className="inline-block py-0.5 font-mono text-xs text-muted underline decoration-dotted underline-offset-4 transition hover:text-accent"
      title="Where this number comes from"
    >
      <span aria-hidden>↳ </span>
      {label ?? sourceLabel(file ?? "")}, {int(rows)} rows
    </Link>
  );
}
