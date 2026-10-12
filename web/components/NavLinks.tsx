"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/explore", label: "Explore" },
  { href: "/guide", label: "Guide" },
  { href: "/sources", label: "Sources" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <ul className="flex items-center gap-2.5 sm:gap-6">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || path.startsWith("/employer") : path.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`label inline-block border-b-2 py-2.5 tracking-[0.04em] transition sm:tracking-[0.08em] ${
                active ? "border-ink text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
