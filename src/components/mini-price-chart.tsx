"use client";

import { useEffect, useState, useRef } from "react";

export function MiniPriceChart({ tokenId }: { tokenId: string }) {
  const [history, setHistory] = useState<{ t: number; p: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ x: number; price: number; date: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/polymarket/price-history?token_id=${tokenId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.history?.length) setHistory(data.history);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tokenId]);

  if (loading) return <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">Loading chart...</div>;
  if (history.length < 2) return <div className="h-[80px] flex items-center justify-center text-[11px] text-[#484f58]">No price history</div>;

  const W = 400;
  const H = 80;
  const prices = history.map((h) => h.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;

  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W;
    const y = H - 4 - ((p - min) / range) * (H - 8);
    return `${x},${y}`;
  });

  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? "#3fb950" : "#f85149";
  const gradientId = `grad-${tokenId.slice(0, 8)}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (history.length - 1));
    const clamped = Math.max(0, Math.min(history.length - 1, idx));
    const point = history[clamped];
    const date = new Date(point.t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    setHover({ x: (clamped / (history.length - 1)) * W, price: point.p, date });
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[80px] cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {hover && (
          <line x1={hover.x} y1={0} x2={hover.x} y2={H} stroke="#484f58" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3,3" />
        )}
      </svg>
      {hover && (
        <div
          className="absolute top-0 pointer-events-none bg-[#1c2128] border border-[#30363d] rounded px-2 py-1 text-[11px] text-white whitespace-nowrap z-10"
          style={{ left: `${(hover.x / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="font-semibold tabular-nums" style={{ color }}>{(hover.price * 100).toFixed(1)}%</span>
          <span className="text-[#484f58] ml-1.5">{hover.date}</span>
        </div>
      )}
    </div>
  );
}
