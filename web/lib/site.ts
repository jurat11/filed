export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://filed-gray.vercel.app").replace(/\/$/, "");

export const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
