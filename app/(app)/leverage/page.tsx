"use client";

import { useState } from "react";

const YIELD_ASSETS = ["WETH", "USDC"];
const DEBT_ASSETS = ["USDC", "WETH"];
const LEVERAGE_OPTIONS = [1.5, 2, 2.5, 3];

export default function LeveragePage() {
  const [yieldAsset, setYieldAsset] = useState("WETH");
  const [debtAsset, setDebtAsset] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(2);

  const amountNum = parseFloat(amount) || 0;
  const estimatedPositionSize = amountNum * leverage;
  const baseApy = yieldAsset === "WETH" ? 3.2 : 5.1;
  const borrowApy = debtAsset === "USDC" ? 4.5 : 2.8;
  const estimatedApy = baseApy * leverage - borrowApy * (leverage - 1);
  const estimatedLiqPrice =
    yieldAsset === "WETH"
      ? (1800 / leverage) * (leverage - 1) * 1.1
      : (1 / leverage) * (leverage - 1) * 1.1;

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Leverage</h1>
        <p className="text-muted-foreground text-sm">
          One-click leveraged positions using flash loans
        </p>
      </div>

      {/* How It Works */}
      <div className="animate-in-delay-1">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How It Works</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              The Looping contract uses flash loans to create leveraged positions in a single transaction
            </p>
          </div>
          <div className="p-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-accent">
                  Open Position
                </h3>
                <p className="text-sm text-muted-foreground">
                  Deposit collateral &rarr; Flash loan &rarr; Swap &rarr;
                  Supply &rarr; Borrow &rarr; Repay flash loan
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-accent">
                  Close Position
                </h3>
                <p className="text-sm text-muted-foreground">
                  Flash loan &rarr; Repay debt &rarr; Withdraw &rarr; Swap
                  &rarr; Repay flash loan
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Open Position Form */}
      <div className="animate-in-delay-2">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Open Leveraged Position</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Select assets and leverage multiplier to open a position
            </p>
          </div>
          <div className="p-4">
            <div className="space-y-6">
              {/* Asset Selection */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Yield Asset (Long)
                  </label>
                  <select
                    value={yieldAsset}
                    onChange={(e) => setYieldAsset(e.target.value)}
                    className="w-full h-10 border border-border bg-background px-3 text-sm font-mono text-foreground focus:border-accent/50 focus:outline-none"
                  >
                    {YIELD_ASSETS.map((a) => (
                      <option key={a} value={a} className="bg-background">
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Debt Asset (Borrow)
                  </label>
                  <select
                    value={debtAsset}
                    onChange={(e) => setDebtAsset(e.target.value)}
                    className="w-full h-10 border border-border bg-background px-3 text-sm font-mono text-foreground focus:border-accent/50 focus:outline-none"
                  >
                    {DEBT_ASSETS.map((a) => (
                      <option key={a} value={a} className="bg-background">
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Amount Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Initial Amount
                </label>
                <input
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-12 text-lg font-mono bg-background border border-border px-4 text-foreground placeholder:text-muted-foreground focus:border-accent/50 focus:outline-none"
                />
              </div>

              {/* Leverage Multiplier */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Leverage Multiplier
                </label>
                <div className="flex gap-2">
                  {LEVERAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      className={`flex-1 h-10 font-mono font-bold text-sm transition-colors ${
                        leverage === opt
                          ? "bg-accent text-background shadow-[0_0_20px_rgba(176,196,255,0.2)]"
                          : "border border-accent/30 text-accent hover:bg-accent hover:text-background"
                      }`}
                      onClick={() => setLeverage(opt)}
                    >
                      {opt}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated Values */}
              {amountNum > 0 && (
                <div className="border border-border/50 bg-background/50 p-4 space-y-3">
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-accent">
                    Position Estimate
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Position Size
                      </p>
                      <p className="text-sm font-mono font-medium text-foreground">
                        {estimatedPositionSize.toFixed(4)} {yieldAsset}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Estimated APY
                      </p>
                      <p
                        className={`text-sm font-mono font-medium ${
                          estimatedApy >= 0 ? "text-green-500" : "text-destructive"
                        }`}
                      >
                        {estimatedApy >= 0 ? "+" : ""}
                        {estimatedApy.toFixed(2)}%
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        Est. Liquidation Price
                      </p>
                      <p className="text-sm font-mono font-medium text-foreground">
                        ${estimatedLiqPrice.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Open Position Button */}
              <div className="space-y-2">
                <button
                  className="w-full h-12 bg-accent text-background font-bold uppercase tracking-[0.2em] text-xs hover:bg-white shadow-[0_0_20px_rgba(176,196,255,0.2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled
                >
                  Open Position
                </button>
                <p className="text-[10px] text-center font-mono uppercase tracking-wider text-muted-foreground">
                  Coming soon &mdash; Looping contract deployment pending
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Positions */}
      <div className="animate-in-delay-3">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Active Positions</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Your leveraged positions and their current status
            </p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Asset</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Size</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Leverage</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Health Factor</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">PnL</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={6}
                  className="h-40 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      No active leveraged positions
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Open a position above to get started
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
