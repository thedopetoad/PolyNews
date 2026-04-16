"use client";

import { useEffect, useState } from "react";
import { formatOdds } from "@/lib/odds-format";
import { useOddsFormat } from "@/stores/use-odds-format";

interface Level { price: string; size: string; }
interface Book { bids: Level[]; asks: Level[]; }

/**
 * Polymarket-style CLOB depth preview: a few rungs of asks on top and bids
 * below, each with price / shares / cumulative total (USDC). Bars fill from
 * the price column toward the size column, widened by cumulative size
 * relative to the thickest level we show — gives a sharp quick visual of
 * where the real liquidity sits.
 *
 * Polls every 5s to match bet slip price refresh, so a user deciding on a
 * size sees depth move with the book.
 */
export function OrderBook({ tokenId, side }: { tokenId: string; side: "BUY" | "SELL" }) {
  const { format } = useOddsFormat();
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    if (!tokenId) return;
    let cancelled = false;
    const fetchBook = async () => {
      try {
        const res = await fetch(`/api/polymarket/book?token_id=${tokenId}`);
        if (!res.ok) return;
        const data: Book = await res.json();
        if (!cancelled) setBook(data);
      } catch {}
    };
    fetchBook();
    const t = setInterval(fetchBook, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tokenId]);

  if (!book) return null;

  // Best first; show up to 4 per side
  const asks = [...book.asks]
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, 4);
  const bids = [...book.bids]
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, 4);

  // For the depth bars, cumulative total across the side to highlight
  // where liquidity thickens.
  const cum = (levels: Level[]) => {
    let running = 0;
    return levels.map((l) => {
      running += parseFloat(l.size);
      return running;
    });
  };
  const askCum = cum(asks);
  const bidCum = cum(bids);
  const maxCum = Math.max(...askCum, ...bidCum, 1);

  // Best prices + spread (in cents — informational, not format-dependent
  // since "spread 1¢" reads the same to anyone).
  const bestAsk = asks[0] ? parseFloat(asks[0].price) : null;
  const bestBid = bids[0] ? parseFloat(bids[0].price) : null;
  const last = bestAsk ?? bestBid;
  const spread = bestAsk !== null && bestBid !== null ? Math.round((bestAsk - bestBid) * 100) : null;

  const Row = ({ level, cumVal, sideKind }: { level: Level; cumVal: number; sideKind: "ask" | "bid" }) => {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    const total = price * size;
    const widthPct = Math.min(100, (cumVal / maxCum) * 100);
    // Highlight the row the user is about to cross (top of opposite side)
    const active =
      (side === "BUY" && sideKind === "ask" && cumVal === askCum[0]) ||
      (side === "SELL" && sideKind === "bid" && cumVal === bidCum[0]);
    return (
      <div className="relative grid grid-cols-3 gap-2 text-[10px] tabular-nums px-2 py-[3px]">
        <div
          className={`absolute inset-y-0 ${sideKind === "ask" ? "right-0 bg-[#f85149]/10" : "right-0 bg-[#3fb950]/10"}`}
          style={{ width: `${widthPct}%` }}
        />
        <span className={`relative text-left font-semibold ${sideKind === "ask" ? "text-[#f85149]" : "text-[#3fb950]"} ${active ? "ring-1 ring-current rounded px-1 -mx-1" : ""}`}>
          {formatOdds(price, format)}
        </span>
        <span className="relative text-right text-[#c9d1d9]">{size.toFixed(0)}</span>
        <span className="relative text-right text-[#768390]">${total < 1000 ? total.toFixed(2) : `${(total / 1000).toFixed(1)}k`}</span>
      </div>
    );
  };

  return (
    <div className="rounded-md border border-[#21262d] bg-[#0d1117] overflow-hidden">
      <div className="grid grid-cols-3 gap-2 px-2 py-1 text-[9px] uppercase tracking-wider text-[#484f58] border-b border-[#21262d]">
        <span>Price</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Total</span>
      </div>
      {asks.length === 0 ? (
        <p className="text-center text-[10px] text-[#484f58] py-2">No asks</p>
      ) : (
        [...asks].reverse().map((l, i) => (
          <Row key={`a${i}`} level={l} cumVal={askCum[asks.length - 1 - i]} sideKind="ask" />
        ))
      )}
      <div className="grid grid-cols-2 gap-2 px-2 py-1 text-[9px] text-[#484f58] bg-[#161b22] border-y border-[#21262d]">
        <span>{last !== null ? `Last: ${formatOdds(last, format)}` : ""}</span>
        <span className="text-right">{spread !== null ? `Spread: ${spread}¢` : ""}</span>
      </div>
      {bids.length === 0 ? (
        <p className="text-center text-[10px] text-[#484f58] py-2">No bids</p>
      ) : (
        bids.map((l, i) => (
          <Row key={`b${i}`} level={l} cumVal={bidCum[i]} sideKind="bid" />
        ))
      )}
    </div>
  );
}
