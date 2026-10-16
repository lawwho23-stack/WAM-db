import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Starfield from "@/components/Starfield";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "WAM-db · Whole Agent Memory",
  description: "Long-term memory and money for one owner and the agents that work for them.",
};

// The root layout is deliberately thin: fonts, the starfield, and nothing else.
// The sidebar shell lives in app/(app)/layout.tsx so the sign-in page can be a
// full-screen moment of its own.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <Starfield />
        {children}
      </body>
    </html>
  );
}
