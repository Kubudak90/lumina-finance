import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-1">
        <div className="text-sm text-muted-foreground font-medium mb-3">{label}</div>
        <div className="text-3xl font-bold font-mono tracking-tight text-foreground">{value}</div>
        {subValue && <div className="text-sm text-muted-foreground mt-2">{subValue}</div>}
      </CardContent>
    </Card>
  );
}
