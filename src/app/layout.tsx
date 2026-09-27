import type { Metadata, Viewport } from "next";
import { DM_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import { config } from "@/lib/config";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });

export const metadata: Metadata = {
  metadataBase: new URL(config.appUrl),
  title: { default: "PhotoLocator · Visual geolocation", template: "%s · PhotoLocator" },
  description:
    "Find where any photo was taken. An open region model ranks places worldwide, then an AI investigator reads the clues and verifies the spot against maps and satellite imagery.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
