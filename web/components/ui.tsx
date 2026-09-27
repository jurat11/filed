import Link from "next/link";

/* Small inline icons (24px grid, 1.75 stroke). Decorative unless given a label. */
const PATHS: Record<string, string> = {
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  info: "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm0-6v-4m0-4h.01",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  building: "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M3 21h18",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6",
  dollar: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  map: "M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Zm0 0V7m6 10V4",
  grad: "M22 10 12 5 2 10l10 5 10-5Zm-16 2v5c3 2 9 2 12 0v-5",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  download: "M12 3v12m0 0-5-5m5 5 5-5M5 21h14",
  check: "M20 6 9 17l-5-5",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Zm0 0A2.5 2.5 0 0 0 6.5 22H20v-5",
  alert: "M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
};

export function Icon({ name, className = "h-4 w-4", label }: { name: keyof typeof PATHS | string; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

/** A titled card. `id` makes it a jump target for the in-page navigation. */
export function Card({
  title,
  id,
  description,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: React.ReactNode;
  id?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section id={id} className={`card ${className}`} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold tracking-tight">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? "mt-4" : "p-5"}>{children}</div>
    </section>
  );
}

/** One headline number with what it means and where it comes from. */
export function StatTile({
  label,
  value,
  note,
  source,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  source?: React.ReactNode;
  icon?: string;
}) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-muted">
        {icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
            <Icon name={icon} />
          </span>
        )}
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      {source && <div className="mt-auto pt-3">{source}</div>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "warn" | "good";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

/** "What does this mean?" A disclosure that works without JavaScript. */
export function Explain({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl bg-surface-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 font-medium text-ink-2 hover:text-ink">
        <Icon name="info" className="h-4 w-4 text-accent" />
        {summary}
        <span aria-hidden className="ml-auto text-muted transition group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-2 px-4 pb-4 text-ink-2">{children}</div>
    </details>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {eyebrow && <div className="text-sm font-medium text-accent">{eyebrow}</div>}
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-3xl text-base text-muted">{children}</div>}
    </header>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  icon,
  download,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  icon?: string;
  download?: boolean;
}) {
  const cls =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:bg-accent-hover"
      : "border border-line bg-surface text-ink hover:border-accent hover:text-accent";
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      {children}
    </>
  );
  const className = `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${cls}`;
  return download ? (
    <a href={href} className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover";
