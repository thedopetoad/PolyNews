"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/hooks/use-user";

// Hand-rolled SVG area chart (no recharts dep). Fetches
// /api/airdrop/history which reconstructs balance from the
// airdrops + trades ledger, then renders an area line.
//
// Each point is { t, balance }. We normalize both axes to
// a viewBox and hover-snap to the nearest index on pointer move.

interface Point {
  t: number;
  balance: number;
}

export function PnlChart() {
  const { address } = useUser();
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/airdrop/history", {
      headers: { Authorization: `Bearer ${address}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.points) setPoints(data.points);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  const {
    linePath, areaPath, minY, maxY, firstB, lastB, delta, gradientId,
  } = useMemo(() => {
    if (!points || points.length < 2) {
      return { linePath: "", areaPath: "", minY: 0, maxY: 0, firstB: 0, lastB: 0, delta: 0, gradientId: "pnl-empty" };
    }
    const W = 400;
    const H = 120;
    const ts = points.map((p) => p.t);
    const bs = points.map((p) => p.balance);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const tRange = Math.max(1, tMax - tMin);
    const bMin = Math.min(...bs);
    const bMax = Math.max(...bs);
    const bRange = Math.max(1, bMax - bMin);
    const pts = points.map((p) => {
      const x = ((p.t - tMin) / tRange) * W;
      const y = H - 6 - ((p.balance - bMin) / bRange) * (H - 12);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      linePath: `M${pts.join(" L")}`,
      areaPath: `M${pts.join(" L")} L${W},${H} L0,${H} Z`,
      minY: bMin,
      maxY: bMax,
      firstB: bs[0],
      lastB: bs[bs.length - 1],
      delta: bs[bs.length - 1] - bs[0],
      gradientId: `pnl-grad-${address?.slice(2, 8) ?? "x"}`,
    };
  }, [points, address]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !points || points.length < 2) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (points.length - 1));
    const W = 400;
    const H = 120;
    const ts = points.map((p) => p.t);
    const bs = points.map((p) => p.balance);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const tRange = Math.max(1, tMax - tMin);
    const bMin = Math.min(...bs);
    const bMax = Math.max(...bs);
    const bRange = Math.max(1, bMax - bMin);
    const x = ((points[i].t - tMin) / tRange) * W;
    const y = H - 6 - ((points[i].balance - bMin) / bRange) * (H - 12);
    setHover({ i, x, y });
  };

  if (!address) {
    return <ChartShell><div className="text-xs text-[#768390] text-center">Log in to see your AIRDROP over time</div></ChartShell>;
  }
  if (loading) return <ChartShell><div className="text-xs text-[#768390] text-center">Loading history…</div></ChartShell>;
  if (!points || points.length < 2) {
    return <ChartShell><div className="text-xs text-[#768390] text-center">Not enough activity yet — claim daily or trade to start a chart</div></ChartShell>;
  }

  const color = delta >= 0 ? "#f5c542" : "#f85149";
  const hoverPoint = hover ? points[hover.i] : null;

  return (
    <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 via-[#161b22] to-[#161b22] p-4 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-[#d4a843]/70 uppercase tracking-wider">AIRDROP over time</p>
        <span className={`text-[10px] font-semibold ${delta >= 0 ? "text-[#f5c542]" : "text-[#f85149]"} tabular-nums`}>
          {delta >= 0 ? "+" : ""}{Math.round(delta).toLocaleString()}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-2xl font-bold text-white tabular-nums">
          {Math.round(hoverPoint?.balance ?? lastB).toLocaleString()}
        </p>
        <span className="text-xs text-[#d4a843]/70">AIRDROP</span>
      </div>
      <div className="relative flex-1 min-h-[120px]">
        <svg
          ref={svgRef}
          viewBox="0 0 400 120"
          className="w-full h-full cursor-crosshair"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {hover && (
            <>
              <line x1={hover.x} y1={0} x2={hover.x} y2={120} stroke="#484f58" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3,3" />
              <circle cx={hover.x} cy={hover.y} r={3} fill={color} stroke="#161b22" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hover && hoverPoint && (
          <div
            className="absolute top-0 pointer-events-none bg-[#1c2128] border border-[#30363d] rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-10"
            style={{ left: `${(hover.x / 400) * 100}%`, transform: "translateX(-50%)" }}
          >
            <span className="font-semibold tabular-nums" style={{ color }}>{Math.round(hoverPoint.balance).toLocaleString()}</span>
            <span className="text-[#484f58] ml-1.5">
              {new Date(hoverPoint.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[9px] text-[#484f58] tabular-nums">
        <span>{Math.round(minY).toLocaleString()}</span>
        <span>{Math.round(firstB).toLocaleString()} → {Math.round(lastB).toLocaleString()}</span>
        <span>{Math.round(maxY).toLocaleString()}</span>
      </div>
    </div>
  );
}

function ChartShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#d4a843]/25 bg-gradient-to-b from-[#d4a843]/5 via-[#161b22] to-[#161b22] p-4 flex flex-col items-center justify-center min-h-[180px]">
      {children}
    </div>
  );
}
