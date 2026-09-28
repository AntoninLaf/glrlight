import type { Metadata } from "next";
import { Archivo, Source_Serif_4 } from "next/font/google";
import "./globals.css";

/**
 * Typefaces are loaded through next/font, which downloads and self-hosts them
 * at build time. No request to Google at page load, no layout shift while a
 * webfont swaps in, and nothing breaks if Google Fonts is blocked.
 *
 * Two families, deliberately distinct:
 *
 *   Archivo — a sturdy grotesque with the character of institutional signage.
 *   Used for the interface and the verdict.
 *
 *   Source Serif — used for findings, explanations and the briefing. Evidence
 *   reads as considered when it is set in serif; the contrast also separates
 *   "what the register says" from "what the interface is doing".
 *
 * `variable` exposes each as a CSS custom property that Tailwind can reference.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GLRlight — UK company risk screening",
  description:
    "Screen any UK company against its public filing record. See what its behaviour on the register suggests before you sign, supply or invoice.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${archivo.variable} ${sourceSerif.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
