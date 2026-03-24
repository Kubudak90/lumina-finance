"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectKitButton } from "connectkit";
import { Button } from "@/components/ui/button";
import { NetworkBadge } from "./NetworkBadge";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/markets", label: "Markets" },
  { href: "/isolated", label: "Isolated" },
  { href: "/leverage", label: "Leverage" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/liquidations", label: "Liquidations" },
  { href: "/faucet", label: "Faucet" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-bold text-xl text-foreground flex items-center gap-1">
            Lumina<span className="text-brand-accent text-2xl leading-none">.</span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  className={`relative ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  render={<Link href={item.href} />}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-brand-accent rounded-full" />
                  )}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NetworkBadge />
          <ConnectKitButton />
        </div>
      </div>
    </nav>
  );
}
