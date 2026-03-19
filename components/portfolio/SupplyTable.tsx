import { TokenIcon } from "@/components/common/TokenIcon";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface SupplyRow {
  symbol: string;
  balance: string;
  value: string;
  apy: string;
}

export function SupplyTable({ rows, onWithdraw }: { rows: SupplyRow[]; onWithdraw: (symbol: string) => void }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No supplies yet</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Balance</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>APY</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.symbol}>
            <TableCell>
              <div className="flex items-center gap-2">
                <TokenIcon symbol={r.symbol} size={24} />
                <span className="font-medium">{r.symbol}</span>
              </div>
            </TableCell>
            <TableCell className="font-mono">{r.balance}</TableCell>
            <TableCell className="font-mono">{r.value}</TableCell>
            <TableCell className="text-success font-mono font-medium">{r.apy}</TableCell>
            <TableCell>
              <Button variant="link" size="sm" onClick={() => onWithdraw(r.symbol)}>
                Withdraw
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
