import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Starfield from "@/components/Starfield";
import Nav from "@/components/Nav";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "WAM-db · Whole Agent Memory",
  description: "Long-term memory and money for one owner and the agents that work for them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <Starfield />
        <div className="flex min-h-screen">
          <Nav />
          <div className="min-w-0 flex-1">
            {/* Mobile: the sidebar is hidden, so a compact bar carries the links. */}
            <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-void/80 px-4 py-3 backdrop-blur md:hidden">
              <span className="num text-[12px] tracking-[0.14em] text-ink">WAM·DB</span>
              <nav className="ml-auto flex gap-3 text-[12px] text-muted">
                <a href="/">Overview</a>
                <a href="/memories">Memory</a>
                <a href="/agents">Agents</a>
                <a href="/runs">Runs</a>
                <a href="/skills">Skills</a>
              </nav>
            </div>
            <main className="mx-auto w-full max-w-6xl px-5 py-7 md:px-8 md:py-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
