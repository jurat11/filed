import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { THEME_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";
import { quarterEnd } from "@/lib/format";
import { meta, siteStats, uscisYears } from "@/lib/queries";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

const description =
  "Which US employers actually file H-1B paperwork for entry-level software and finance roles, and at what pay. Built from DOL and USCIS public records.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://filed-gray.vercel.app"),
  title: { default: "Filed: H-1B filings by employer, from public records", template: "%s | Filed" },
  description,
  openGraph: { siteName: "Filed", type: "website", title: "Filed", description },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f12" },
  ],
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Filed, home">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">
        F
      </span>
      <span className="hidden text-lg sm:inline">Filed</span>
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
      <body className={`${inter.variable} ${mono.variable} min-h-screen font-sans antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
          <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
            <Logo />
            <NavLinks />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none sm:py-12">
          {children}
        </main>
        <footer className="mt-16 border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted sm:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <p className="font-medium text-ink">Filed</p>
              <p>
                Built only from U.S. Department of Labor and USCIS public records. Not legal advice. An
                LCA is filed before a petition and does not mean a visa was approved. Past filings do
                not guarantee future sponsorship.
              </p>
              <Freshness />
            </div>
            <ul className="space-y-2 sm:justify-self-end">
              <li><Link href="/guide" className="hover:text-ink">How to read the numbers</Link></li>
              <li><Link href="/sources" className="hover:text-ink">Sources and method</Link></li>
              <li><a href="https://github.com/jurat11/filed" className="hover:text-ink">Code and data decisions</a></li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
