import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/providers";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { RouteProgressBar } from "@/components/layout/route-progress-bar";
import { Suspense } from "react";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PolyStream | Live News + Prediction Markets",
  description:
    "Track live news, match it to Polymarket prediction markets, get AI consensus predictions, and paper trade with virtual tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-[#0d1117]">
        <Providers>
          {/* Global nprogress-style bar — fires on route change and while
              any react-query request is in flight. Suspense boundary
              because useSearchParams bails out of static rendering. */}
          <Suspense fallback={null}>
            <RouteProgressBar />
          </Suspense>
          <Navbar />
          <main className="flex-1 pt-14">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
