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
    <div className="bg-white border border-brand-border rounded-xl p-4 shadow-sm">
      <h4 className="text-sm text-text-secondary mb-4 font-medium">Interest Rate Curve</h4>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#F3F4F6"
          />
          <XAxis
            dataKey="utilization"
            tick={{ fill: "#6B7280", fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            tick={{ fill: "#6B7280", fontSize: 11 }}
            tickFormatter={(v) => `${v.toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#FFFFFF",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
            }}
            labelFormatter={(v) => `Utilization: ${v}%`}
            formatter={(v) => [`${Number(v).toFixed(2)}%`]}
          />
          <Line
            type="monotone"
            dataKey="borrowRate"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            name="Borrow Rate"
          />
          <Line
            type="monotone"
            dataKey="supplyRate"
            stroke="#059669"
            strokeWidth={2}
            dot={false}
            name="Supply Rate"
          />
          <ReferenceLine
            x={currentUtilRounded}
            stroke="#6B7280"
            strokeDasharray="5 5"
            label={{
              value: "Current",
              fill: "#6B7280",
              fontSize: 11,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
