export default function IsolatedPage() {
  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">
          Isolated Markets
        </h1>
        <p className="text-muted-foreground text-sm">
          Risk-isolated lending pairs with independent collateral
        </p>
      </div>

      <div className="animate-in-delay-1">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How Isolated Pools Work</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Isolated markets use LuminaPair contracts for maximum risk separation
            </p>
          </div>
          <div className="p-4">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>
                  Each pair is independent &mdash; one asset paired with one
                  collateral (asset &#x2194; collateral)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>
                  Failure in one pair does not affect others &mdash; risk is
                  fully contained
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>
                  Higher LTV ratios are possible for specific, well-understood
                  pairs
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="animate-in-delay-1">
        <div className="technical-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Pair</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Asset APY</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Max LTV</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={5}
                  className="h-40 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      Coming Soon
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Isolated markets will be available after LighterEVM
                      mainnet launch
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
