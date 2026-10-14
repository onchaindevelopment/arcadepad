import type { Metadata, Viewport } from "next";
import { Bungee, Doto, Geist, Geist_Mono, Silkscreen, Tiny5 } from "next/font/google";
import { BRAND } from "@/brand";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteAudio } from "@/components/SiteAudio";
import { Suspense } from "react";
import "./globals.css";

const doto = Doto({ variable: "--font-doto", subsets: ["latin"], weight: "variable", axes: ["ROND"], display: "swap" });
const bungee = Bungee({ variable: "--font-bungee", subsets: ["latin"], weight: "400", display: "swap" });
const tiny5 = Tiny5({ variable: "--font-tiny5", subsets: ["latin"], weight: "400", display: "swap" });
const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const silk = Silkscreen({ variable: "--font-silk", subsets: ["latin"], weight: ["400", "700"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4155"),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  authors: [{ name: BRAND.name }],
  openGraph: { siteName: BRAND.name, type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#12062a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bungee.variable} ${tiny5.variable} ${doto.variable} ${geist.variable} ${geistMono.variable} ${silk.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 btn btn-sun">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <Suspense fallback={null}>
          <SiteAudio />
        </Suspense>
      </body>
    </html>
  );
}
