import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <Card>
      <CardContent className="relative">
        <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">{label}</div>
        <div className="text-2xl font-bold font-mono text-foreground">{value}</div>
        {subValue && <div className="text-sm text-muted-foreground mt-1">{subValue}</div>}
      </CardContent>
    </Card>
  );
}
