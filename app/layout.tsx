import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { Navbar } from "@/components/layout/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LightLend — Lending on Lighter EVM",
  description: "The first lending protocol on Lighter EVM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-brand-dark text-white min-h-screen`}>
        <Web3Provider>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
        </Web3Provider>
      </body>
    </html>
  );
}
