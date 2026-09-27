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
    <ul className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || path.startsWith("/employer") : path.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
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
