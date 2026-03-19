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

interface BorrowRow {
  symbol: string;
  debt: string;
  value: string;
  apy: string;
}

export function BorrowTable({ rows, onRepay }: { rows: BorrowRow[]; onRepay: (symbol: string) => void }) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No borrows</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Debt</TableHead>
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
            <TableCell className="font-mono">{r.debt}</TableCell>
            <TableCell className="font-mono">{r.value}</TableCell>
            <TableCell className="text-warning font-mono font-medium">{r.apy}</TableCell>
            <TableCell>
              <Button variant="link" size="sm" onClick={() => onRepay(r.symbol)}>
                Repay
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
