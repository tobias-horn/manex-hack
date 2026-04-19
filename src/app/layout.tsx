import type { Metadata } from "next";
import { Geist_Mono, Inter, Manrope } from "next/font/google";

import { AskTheAgent } from "@/components/ask-the-agent";
import { ThemeToggle } from "@/components/theme-toggle";
import { capabilities } from "@/lib/env";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Manex Forensic Lens",
  description:
    "A forensic-quality workspace for live manufacturing analysis, AI drafting, and closed-loop actions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="pointer-events-none fixed top-4 right-4 z-50 sm:top-6 sm:right-6">
          <div className="pointer-events-auto">
            <ThemeToggle />
          </div>
        </div>
        {children}
        {capabilities.hasAi && (capabilities.hasPostgres || capabilities.hasRest) ? (
          <AskTheAgent />
        ) : null}
      </body>
    </html>
  );
}
