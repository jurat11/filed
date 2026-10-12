import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { NavLinks } from "@/components/NavLinks";
import { THEME_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";
import { quarterEnd } from "@/lib/format";
import { meta, siteStats, uscisYears } from "@/lib/queries";
import "./globals.css";

// Text in a serif with an optical-size axis (sharp at display sizes); labels and figures in a mono.
const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const description =
  "Which US employers actually file H-1B paperwork for entry-level software and finance roles, and at what pay. Built from DOL and USCIS public records.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://filed-gray.vercel.app"),
  title: { default: "Filed: H-1B filings by employer, from public records", template: "%s | Filed" },
  description,
  openGraph: {
    siteName: "Filed",
    type: "website",
    title: "Filed: which employers file H-1B paperwork, and at what pay",
    description,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe3" },
    { media: "(prefers-color-scheme: dark)", color: "#14120e" },
  ],
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Filed, home">
      <LogoMark />
      <span className="hidden text-[1.7rem] font-bold leading-none tracking-tight sm:inline">Filed</span>
    </Link>
  );
}

async function Freshness() {
  const [s, u, m] = await Promise.all([siteStats(), uscisYears(), meta()]);
  const through = s.latestYear && s.latestQuarter ? quarterEnd(s.latestYear, s.latestQuarter) : null;
  return (
    <p>
      DOL LCA data{through ? ` through ${through} (FY${s.latestYear} Q${s.latestQuarter} release)` : ""}. USCIS
      data: {u.map((y) => `FY${y}`).join(", ") || "none loaded"}. Loaded {m.loaded_at?.slice(0, 10) ?? "–"}.
    </p>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${serif.variable} ${mono.variable} min-h-screen font-serif antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-ink focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b-[3px] border-double border-ink">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-3 sm:gap-8">
            <Logo />
            <NavLinks />
            <p className="label ml-auto hidden text-muted lg:block">H-1B filings index, from public records</p>
            <div className="ml-auto lg:ml-0">
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none sm:py-12">
          {children}
        </main>
        <footer className="mt-16 border-t-[3px] border-double border-ink">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-[0.9375rem] text-muted sm:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <p className="label text-ink">Filed, colophon</p>
              <p>
                Built only from U.S. Department of Labor and USCIS public records. Not legal advice. An
                LCA is filed before a petition and does not mean a visa was approved. Past filings do
                not guarantee future sponsorship.
              </p>
              <Freshness />
            </div>
            <ul className="space-y-2 sm:justify-self-end">
              <li><Link href="/guide" className="underline underline-offset-4 hover:text-ink">How to read the numbers</Link></li>
              <li><Link href="/sources" className="underline underline-offset-4 hover:text-ink">Sources and method</Link></li>
              <li><a href="https://github.com/jurat11/filed" className="underline underline-offset-4 hover:text-ink">Code and data decisions</a></li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
