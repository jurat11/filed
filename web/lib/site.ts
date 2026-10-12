export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://filed-gray.vercel.app").replace(/\/$/, "");

/** The default share card (app/opengraph-image.tsx). A page that sets its own `openGraph`
 * replaces the root's, including the file-based image, so it lists this explicitly. */
export const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Filed: which employers file H-1B paperwork, and at what pay",
};

export const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
