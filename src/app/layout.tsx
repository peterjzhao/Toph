import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { webDesignTokens } from "@/lib/design-tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard · Toph",
  description: "An overview of your farm and employee activity.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.variable} style={webDesignTokens}>
      <body>{children}</body>
    </html>
  );
}
