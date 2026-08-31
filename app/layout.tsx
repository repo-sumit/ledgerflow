import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerFlow - Invoice Decisioning",
  description: "Explainable invoice controls from PDF intake to payment decision.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-[#f5f7fb]">
      <body className="antialiased">{children}</body>
    </html>
  );
}
