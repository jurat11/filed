import Link from "next/link";
import { int, sourceLabel } from "@/lib/format";

/** Where a figure comes from: the file (or a written label) and the rows behind it. */
export function SourceTag({ file, label, rows }: { file?: string; label?: string; rows: unknown }) {
  return (
    <Link
      href="/sources"
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted transition hover:border-accent hover:text-accent"
      title="Where this number comes from"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
      </svg>
      {label ?? sourceLabel(file ?? "")}, {int(rows)} rows
    </Link>
  );
}
