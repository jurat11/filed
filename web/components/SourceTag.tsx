import Link from "next/link";
import { int, sourceLabel } from "@/lib/format";

export function SourceTag({ file, rows }: { file: string; rows: unknown }) {
  return (
    <Link
      href="/sources"
      className="inline-block rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-ink"
      title="Where this number comes from"
    >
      {sourceLabel(file)}, {int(rows)} rows
    </Link>
  );
}
