"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectKitButton } from "connectkit";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/liquidations", label: "Liquidations" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-brand-dark/95 backdrop-blur border-b border-brand-border">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-brand-cyan font-bold text-xl">
            LightLend
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "text-white bg-white/5"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <ConnectKitButton />
      </div>
    </nav>
  );
}
