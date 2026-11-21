"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  TrendingUp,
  Zap,
  Lock,
  Coins,
  ChartLine,
  X,
} from "lucide-react";
import { isLighterPath } from "@/lib/lighter/config";
import { NETWORK_NAME } from "@/lib/chains";
import { LUMINA_CHAIN_ID } from "@/lib/deployments";
import { useSidebar } from "@/providers/SidebarProvider";

const MAIN_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: TrendingUp },
  { href: "/isolated", label: "Isolated", icon: Lock },
  { href: "/portfolio", label: "Portfolio", icon: Coins },
  { href: "/liquidations", label: "Liquidations", icon: Activity },
  { href: "/lighter", label: "Lighter", icon: ChartLine },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isMobileOpen, closeMobile } = useSidebar();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const navContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-accent/10">
          <Zap className="w-4 h-4 text-accent" />
        </div>
        <span className="text-sm font-bold tracking-widest glow-text">
          LUMINA
        </span>
        {/* Mobile close */}
        <button
          onClick={closeMobile}
          className="ml-auto lg:hidden text-text-dim hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Menu */}
      <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        <p className="px-3 mb-3 text-[10px] font-semibold tracking-widest text-text-dim uppercase">
          Main Menu
        </p>
        {MAIN_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMobile}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors
                ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-text-dim hover:bg-overlay hover:text-foreground"
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Network Status */}
      <div className="p-4">
        <div className="technical-border rounded-md p-3">
          <span className="text-[10px] font-semibold tracking-widest text-text-dim uppercase">
            Network
          </span>
          <p className="mt-1.5 text-xs font-mono text-foreground">
            {isLighterPath(pathname) ? "Lighter trading (read-only)" : NETWORK_NAME}
          </p>
          {!isLighterPath(pathname) && (
            <p className="mt-0.5 text-[10px] font-mono text-text-dim">chain {LUMINA_CHAIN_ID}</p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-64 flex-col bg-card border-r border-border">
        {navContent}
      </aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 flex-col bg-card border-r border-border
          transform transition-transform duration-200 ease-out lg:hidden
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {navContent}
      </aside>
    </>
  );
}
