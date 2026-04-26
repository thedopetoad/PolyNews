"use client";

import { TradableMarketsTab } from "@/app/trade/page";

// Thin wrapper around TradableMarketsTab. Used to fetch + pass markets
// in for v1; v2 reads markets straight from /api/consensus/latest inside
// TradableMarketsTab so this wrapper is now nearly trivial.
export function AirdropTradeTab() {
  return <TradableMarketsTab onBought={() => {}} />;
}
