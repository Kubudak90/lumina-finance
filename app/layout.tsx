import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lumina Finance — Lending on Lighter",
  description: "The first lending protocol on Lighter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <Web3Provider>
          {children}
          <Toaster position="bottom-right" richColors theme="dark" />
        </Web3Provider>
      </body>
    </html>
  );
}
