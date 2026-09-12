"use client";

import { usePathname } from "next/navigation";
import { WalletButton } from "@/components/common/WalletButton";
import { Menu } from "lucide-react";
import { useSidebar } from "@/providers/SidebarProvider";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/markets": "Markets",
  "/isolated": "Isolated",
  "/leverage": "Leverage",
  "/portfolio": "Portfolio",
  "/liquidations": "Liquidations",
  "/faucet": "Faucet",
};

export function Header() {
  const pathname = usePathname();
  const { openMobile } = useSidebar();

  const currentLabel =
    ROUTE_LABELS[pathname] ??
    ROUTE_LABELS[Object.keys(ROUTE_LABELS).find((k) => k !== "/" && pathname.startsWith(k)) ?? ""] ??
    "Lumina Finance";

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-background/50 backdrop-blur-md">
      <div className="flex items-center justify-between h-full px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={openMobile}
            className="lg:hidden text-text-dim hover:text-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-dim">Lumina Finance</span>
            <span className="text-text-dim">/</span>
            <span className="text-foreground font-medium">{currentLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
