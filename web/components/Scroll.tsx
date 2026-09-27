/** A horizontally scrolling wrapper for wide tables. Focusable and labeled, so keyboard
 * users can scroll it on small screens (axe: scrollable-region-focusable). */
export function Scroll({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto ${className}`}>
      {children}
    </div>
  );
}
