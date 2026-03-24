"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface RateCurveChartProps {
  baseRate: number;
  slope1: number;
  slope2: number;
  optimalUtil: number;
  currentUtil: number;
}

export function RateCurveChart({
  baseRate,
  slope1,
  slope2,
  optimalUtil,
  currentUtil,
}: RateCurveChartProps) {
  const data = Array.from({ length: 101 }, (_, i) => {
    const util = i / 100;
    let borrowRate: number;
    if (util <= optimalUtil) {
      borrowRate = baseRate + (util / optimalUtil) * slope1;
    } else {
      const excess = (util - optimalUtil) / (1 - optimalUtil);
      borrowRate = baseRate + slope1 + excess * slope2;
    }
    const supplyRate = borrowRate * util * 0.9;
    return {
      utilization: i,
      borrowRate: borrowRate * 100,
      supplyRate: supplyRate * 100,
    };
  });

  const currentUtilRounded = Math.round(currentUtil);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">Interest Rate Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
            />
            <XAxis
              dataKey="utilization"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 0,
              }}
              labelFormatter={(v) => `Utilization: ${v}%`}
              formatter={(v) => [`${Number(v).toFixed(2)}%`]}
            />
            <Line
              type="monotone"
              dataKey="borrowRate"
              stroke="#B0C4FF"
              strokeWidth={2}
              dot={false}
              name="Borrow Rate"
            />
            <Line
              type="monotone"
              dataKey="supplyRate"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
              name="Supply Rate"
            />
            <ReferenceLine
              x={currentUtilRounded}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              label={{
                value: "Current",
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
