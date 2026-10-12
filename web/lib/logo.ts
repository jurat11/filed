/** The Filed mark: a filed document with a small bar chart on the page (filings and pay).
 * Drawn on a 32x32 grid; the page, the folded corner and the bars are separate paths so the
 * header (theme colors via CSS) and the share cards and icons (fixed hex colors) can color
 * them differently. Used by components/LogoMark.tsx and lib/og.tsx. */
export const LOGO_VIEWBOX = "0 0 32 32";
export const LOGO_PAGE = "M6 3H19L26 10V29H6Z";
export const LOGO_FOLD = "M19 3V10H26Z";
export const LOGO_BARS = ["M10 25V20H13V25Z", "M14.5 25V17H17.5V25Z", "M19 25V14H22V25Z"];
