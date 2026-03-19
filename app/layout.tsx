import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { Navbar } from "@/components/layout/Navbar";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "LightLend — Lending on Lighter EVM",
  description: "The first lending protocol on Lighter EVM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} font-sans bg-brand-bg text-text-primary min-h-screen`}>
        <Web3Provider>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
        </Web3Provider>
      </body>
    </html>
  );
}
