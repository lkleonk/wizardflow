import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ColorSchemeScript from "@/components/ColorSchemeScript";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Production origin. Override with NEXT_PUBLIC_SITE_URL for preview/staging
// deploys; the default is the live domain so canonical/OG/sitemap URLs resolve
// absolutely without any extra config.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://getwizardflow.com";

const description =
  "WizardFlow is a browser-based viewer for agent runs. Upload a trace " +
  "file to replay an agent flow step by step — message timeline, ordered " +
  "node execution, live graph activity, and full payload inspection. " +
  "Everything runs locally; no data leaves your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "WizardFlow — Replay and inspect agent flows",
    template: "%s · WizardFlow",
  },
  description,
  applicationName: "WizardFlow",
  keywords: [
    "agent flow",
    "LLM agent",
    "agent visualization",
    "agent debugging",
    "agent observability",
    "LangGraph",
    "agent trace viewer",
    "flow replay",
    "node graph",
    "payload inspection",
  ],
  authors: [{ name: "Leon Koch", url: "https://github.com/lkleonk" }],
  creator: "Leon Koch",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "WizardFlow",
    title: "WizardFlow — Replay and inspect agent flows",
    description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "WizardFlow — Replay and inspect agent flows",
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <ColorSchemeScript />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
