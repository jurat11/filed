import { LOGO_BARS, LOGO_FOLD, LOGO_PAGE, LOGO_VIEWBOX } from "@/lib/logo";

/** The Filed mark inside the accent badge. Colors follow the theme: the page takes the
 * badge's ink color, the bars and the folded corner take the accent. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-[3px] bg-accent text-accent-ink ${className}`}
    >
      <svg viewBox={LOGO_VIEWBOX} className="h-[78%] w-[78%]">
        <path d={LOGO_PAGE} fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        <path d={LOGO_FOLD} className="fill-accent" fillOpacity={0.35} />
        {LOGO_BARS.map((d) => (
          <path key={d} d={d} className="fill-accent" />
        ))}
      </svg>
    </span>
  );
}
