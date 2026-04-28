"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * Polymarket CLOB price history sparkline.
 *
 * Migrated from a hand-rolled SVG path renderer to shadcn's Chart
 * (recharts AreaChart under the hood). Same look — color shifts
 * green/red based on first→last price direction, soft gradient fill
 * underneath. Hover gives a proper tooltip card with date + price
 * instead of the old custom-positioned div.
 */
export function MiniPriceChart({ tokenId }: { tokenId: string }) {
  const [history, setHistory] = useState<{ t: number; p: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/polymarket/price-history?token_id=${tokenId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.history?.length) setHistory(data.history);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId]);

  const { chartData, color, config } = useMemo(() => {
    if (history.length < 2) {
      return {
        chartData: [],
        color: "#3fb950",
        config: { price: { label: "Price", color: "#3fb950" } } satisfies ChartConfig,
      };
    }
    const isUp = history[history.length - 1].p >= history[0].p;
    const c = isUp ? "#3fb950" : "#f85149";
    const data = history.map((h) => ({
      t: h.t,
      p: h.p,
      // Pre-format the date here instead of in tooltipContent so
      // recharts axes don't have to do it repeatedly.
      dateLabel: new Date(h.t * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      pricePct: (h.p * 100).toFixed(1) + "%",
    }));
    return {
      chartData: data,
      color: c,
      config: { price: { label: "Price", color: c } } satisfies ChartConfig,
    };
  }, [history]);

  if (loading) {
    return (
      <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">
        Loading chart...
      </div>
    );
  }
  if (chartData.length < 2) {
    return (
      <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">
        No price history
      </div>
    );
  }

  const gradientId = `mini-price-grad-${tokenId.slice(0, 8)}`;

  return (
    <ChartContainer config={config} className="aspect-auto h-[80px] w-full">
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area
          type="monotone"
          dataKey="p"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3, fill: color, stroke: "#0d1117", strokeWidth: 1.5 }}
        />
        <ChartTooltip
          cursor={{ stroke: "#484f58", strokeDasharray: "3 3", strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(_value, _name, item) => {
                const d = item.payload as (typeof chartData)[number];
                return (
                  <div className="flex flex-col gap-0.5">
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color }}
                    >
                      {d.pricePct}
                    </span>
                    <span className="text-[#484f58] text-[10px]">
                      {d.dateLabel}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}
