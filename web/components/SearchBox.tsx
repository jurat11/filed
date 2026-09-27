"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { aliasNote } from "@/lib/search";

type Suggestion = {
  slug: string;
  name: string;
  state: string | null;
  alias: string;
  has_lca: boolean;
  certified_total: number | null;
};

/**
 * Employer search input with typeahead. It sits inside a plain GET form, so without
 * JavaScript (or before it loads) submitting still shows server-rendered results.
 */
export function SearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(defaultValue);
  const [dirty, setDirty] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const term = q.trim();
    if (!dirty || term.length < 2) {
      setItems([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (res.ok) {
          setItems(await res.json());
          setActive(-1);
          setOpen(true);
        }
      } catch {
        // Aborted or offline: the form still works.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, dirty]);

  const go = (s: Suggestion) => {
    setOpen(false);
    router.push(`/employer/${s.slug}`);
  };
  const shown = open && items.length > 0;

  return (
    <div className="relative w-full">
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
        <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35" />
      </svg>
      <input
        name="q"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setDirty(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp" && items.length) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
          } else if (e.key === "Enter" && shown && active >= 0) {
            e.preventDefault();
            go(items[active]);
          }
        }}
        onBlur={() => setOpen(false)}
        onFocus={() => items.length && setOpen(true)}
        placeholder="Search an employer, e.g. Capital One"
        aria-label="Employer name"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="h-12 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-base shadow-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent-soft"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Employer suggestions"
        hidden={!shown}
        className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
      >
        {items.map((s, i) => {
          const note = aliasNote(s.name, s.alias);
          return (
            <li
              key={s.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-4 py-2.5 text-sm ${i === active ? "bg-accent-soft" : ""}`}
            >
              <span className="font-medium">{s.name}</span>
              <span className="ml-2 text-muted">{s.state}</span>
              {note && <span className="block text-xs text-muted">matched &ldquo;{note}&rdquo;</span>}
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {shown ? `${items.length} suggestions. Use the arrow keys to choose.` : ""}
      </p>
    </div>
  );
}
