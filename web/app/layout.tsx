import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Filed", template: "%s | Filed" },
  description:
    "Which US employers actually file H-1B paperwork for entry-level software and finance roles, and at what pay. Built from DOL and USCIS public records.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-baseline gap-6 px-4 py-4">
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
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
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
