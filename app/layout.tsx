import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, Lora } from "next/font/google";
import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Imperium",
  description:
    "A browser-based medieval RPG of empire, intrigue, and craft. Alea Iacta Est.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${cormorant.variable} ${lora.variable}`}
    >
      <body
        className="antialiased min-h-screen bg-parchment text-parchment"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
