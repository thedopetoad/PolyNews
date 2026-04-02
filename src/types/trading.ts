export interface Position {
  marketId: string;
  marketQuestion: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  marketId: string;
  marketQuestion: string;
  outcome: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  timestamp: number;
}

export interface AirdropRecord {
  id: string;
  source: "signup" | "daily" | "weekly" | "referral" | "referral_trade";
  amount: number;
  timestamp: number;
}
