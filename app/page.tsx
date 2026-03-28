"use client";

import Link from "next/link";
import { ConnectKitButton } from "connectkit";
import {
  Zap,
  ArrowRight,
  Shield,
  TrendingUp,
  Layers,
  ChevronRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Supply & Earn",
    description: "Deposit assets and earn yield from borrowers. Interest accrues every second.",
  },
  {
    icon: Layers,
    title: "Borrow Against Collateral",
    description: "Leverage your assets by borrowing against them. Variable rates, no fixed terms.",
  },
  {
    icon: Shield,
    title: "Battle-Tested Security",
    description: "Built on Aave V3 — the most audited DeFi protocol. Your assets are protected.",
  },
  {
    icon: Zap,
    title: "Powered by Lighter",
    description: "Ultra-fast execution on Lighter's ZK rollup. Low fees, instant finality.",
  },
];

const STATS = [
  { label: "Protocol", value: "Aave V3" },
  { label: "Chain", value: "Lighter" },
  { label: "Markets", value: "USDC, LIT" },
  { label: "Status", value: "Testnet" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-accent/10">
              <Zap className="w-4 h-4 text-accent" />
            </div>
            <span className="text-sm font-bold tracking-widest glow-text">LUMINA</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-text-dim hover:text-foreground transition-colors"
            >
              App <ChevronRight className="w-3 h-3" />
            </Link>
            <ConnectKitButton />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex items-center justify-center pt-16">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 border border-accent/30 bg-accent/5 px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest text-accent">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Live on Base Sepolia Testnet
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[0.9]">
              <span className="glow-text">Lending</span>
              <br />
              <span className="text-text-dim">on Lighter</span>
            </h1>

            <p className="text-lg md:text-xl text-text-dim max-w-xl mx-auto leading-relaxed">
              The first lending protocol on the Lighter ecosystem.
              Supply, borrow, and earn — powered by Aave V3.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 h-12 px-8 bg-accent text-background font-bold uppercase tracking-[0.2em] text-xs hover:bg-white shadow-[0_0_30px_rgba(176,196,255,0.25)] transition-all"
              >
                Launch App
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/faucet"
                className="flex items-center gap-2 h-12 px-8 border border-accent/30 text-accent text-xs font-bold uppercase tracking-[0.2em] hover:bg-accent/10 transition-colors"
              >
                Get Test Tokens
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-border/50 bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim mb-1">
                  {stat.label}
                </div>
                <div className="text-sm font-mono font-bold text-foreground">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tighter glow-text mb-3">
              Built for DeFi
            </h2>
            <p className="text-text-dim max-w-md mx-auto">
              Everything you need to lend and borrow on Lighter
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="technical-border bg-card p-6 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-accent/10 rounded-lg shrink-0">
                      <Icon className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground mb-1.5">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-text-dim leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-border/50">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tighter glow-text mb-4">
            Start Earning Today
          </h2>
          <p className="text-text-dim mb-8 max-w-md mx-auto">
            Connect your wallet, get test tokens from the faucet, and experience
            the future of lending on Lighter.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 h-12 px-8 bg-accent text-background font-bold uppercase tracking-[0.2em] text-xs hover:bg-white shadow-[0_0_30px_rgba(176,196,255,0.25)] transition-all"
          >
            Launch App
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Zap className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-mono tracking-widest text-text-dim">LUMINA FINANCE</span>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
            Powered by Aave V3 on Lighter
          </div>
        </div>
      </footer>
    </div>
  );
}
