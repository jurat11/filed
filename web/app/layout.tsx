import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

const description =
  "Which US employers actually file H-1B paperwork for entry-level software and finance roles, and at what pay. Built from DOL and USCIS public records.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://filed-gray.vercel.app"),
  title: { default: "Filed", template: "%s | Filed" },
  description,
  openGraph: { siteName: "Filed", type: "website", title: "Filed", description },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-line">
          <nav aria-label="Main" className="mx-auto flex max-w-5xl items-baseline gap-6 px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Filed
            </Link>
            <Link href="/explore" className="text-sm text-muted hover:text-ink">
              Explore
            </Link>
            <Link href="/sources" className="text-sm text-muted hover:text-ink">
              Sources
            </Link>
          </nav>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 outline-none">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
            <p>
              Not legal advice. An LCA is filed before a petition and does not mean a visa was
              approved. Past filings do not guarantee future sponsorship.
            </p>
            <p className="mt-2">
              Built from U.S. Department of Labor and USCIS public records.{" "}
              <Link href="/sources" className="underline hover:text-ink">
                Sources and method
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
