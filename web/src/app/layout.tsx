import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Speed Insights is a Vercel-only telemetry component — no-op anywhere
// else, and the module isn't always resolvable in local dev (Turbopack
// can resolve from the parent dir under multi-package-json setups). Load
// it dynamically only when running on Vercel so local dev doesn't even
// try to require it.
async function SpeedInsightsIfVercel() {
  if (!process.env.VERCEL) return null;
  try {
    const { SpeedInsights } = await import("@vercel/speed-insights/next");
    return <SpeedInsights />;
  } catch {
    return null;
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stock invoicing",
  description: "Monthly stock invoicing report review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SpeedInsightsIfVercel />
      </body>
    </html>
  );
}
