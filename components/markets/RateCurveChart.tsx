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
    <div className="bg-brand-card border border-brand-border rounded-xl p-4">
      <h4 className="text-sm text-slate-400 mb-4">Interest Rate Curve</h4>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            dataKey="utilization"
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid rgba(6,182,212,0.2)",
              borderRadius: 8,
            }}
            labelFormatter={(v) => `Utilization: ${v}%`}
            formatter={(v) => [`${Number(v).toFixed(2)}%`]}
          />
          <Line
            type="monotone"
            dataKey="borrowRate"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            name="Borrow Rate"
          />
          <Line
            type="monotone"
            dataKey="supplyRate"
            stroke="#4ade80"
            strokeWidth={2}
            dot={false}
            name="Supply Rate"
          />
          <ReferenceLine
            x={currentUtilRounded}
            stroke="#06b6d4"
            strokeDasharray="5 5"
            label={{
              value: "Current",
              fill: "#06b6d4",
              fontSize: 11,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
