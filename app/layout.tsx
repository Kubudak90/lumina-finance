import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/providers/Web3Provider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { ThemedToaster } from "@/components/theme/ThemedToaster";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lumina Finance — EVM lending with Lighter",
  description: "Lending and borrowing on Lighter EVM, with an integrated Lighter portfolio view",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the head script sets data-theme on <html> before React hydrates.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ThemeProvider>
          <Web3Provider>
            {children}
            <ThemedToaster />
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
