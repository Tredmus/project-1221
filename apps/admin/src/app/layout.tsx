import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project 1221 Admin",
  description: "Map editor and world management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>/<body> before React loads.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex h-full flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
