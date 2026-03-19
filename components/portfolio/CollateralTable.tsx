import { TokenIcon } from "@/components/common/TokenIcon";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface CollateralRow {
  symbol: string;
  amount: string;
  value: string;
  ltv: string;
}

export function CollateralTable({ rows }: { rows: CollateralRow[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No collateral deposited</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>LTV</TableHead>
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
            <TableCell className="font-mono">{r.amount}</TableCell>
            <TableCell className="font-mono">{r.value}</TableCell>
            <TableCell className="font-mono">{r.ltv}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
