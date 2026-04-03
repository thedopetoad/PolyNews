import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Users - identified by wallet address or OAuth ID
export const users = pgTable("users", {
  id: text("id").primaryKey(), // wallet address or oauth sub
  displayName: text("display_name"),
  authMethod: text("auth_method").notNull(), // "wallet" | "google"
  walletAddress: text("wallet_address"),
  referralCode: text("referral_code").notNull().unique(),
  referredBy: text("referred_by"), // referral code of the user who referred them
  balance: real("balance").notNull().default(10000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at").notNull().defaultNow(),
  lastDailyAirdrop: text("last_daily_airdrop"), // date string
  lastWeeklyAirdrop: text("last_weekly_airdrop"), // week string
  hasSignupAirdrop: boolean("has_signup_airdrop").notNull().default(false),
});

// Paper trading positions
export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  marketId: text("market_id").notNull(),
  marketQuestion: text("market_question").notNull(),
  outcome: text("outcome").notNull(), // "Yes", "No", "Up", or "Down"
  shares: real("shares").notNull(),
  avgPrice: real("avg_price").notNull(),
  clobTokenId: text("clob_token_id"), // For direct CLOB price lookups even if market leaves events API
  marketEndDate: text("market_end_date"), // ISO date string — when the market resolves
  eventSlug: text("event_slug"), // For linking to Polymarket
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Trade history
export const trades = pgTable("trades", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  marketId: text("market_id").notNull(),
  marketQuestion: text("market_question").notNull(),
  outcome: text("outcome").notNull(),
  side: text("side").notNull(), // "buy" or "sell"
  shares: real("shares").notNull(),
  price: real("price").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Airdrop records
export const airdrops = pgTable("airdrops", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  source: text("source").notNull(), // "signup" | "daily" | "weekly" | "referral" | "referral_trade"
  amount: real("amount").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI consensus cache
export const consensusCache = pgTable("consensus_cache", {
  id: text("id").primaryKey(), // market question hash
  marketQuestion: text("market_question").notNull(),
  result: text("result").notNull(), // JSON stringified consensus result
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Referral tracking
export const referrals = pgTable(
  "referrals",
  {
    id: text("id").primaryKey(),
    referrerId: text("referrer_id").notNull().references(() => users.id),
    referredId: text("referred_id").notNull().references(() => users.id),
    signupBonusPaid: boolean("signup_bonus_paid").notNull().default(false),
    firstTradeBonusPaid: boolean("first_trade_bonus_paid").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("referrals_referred_id_idx").on(table.referredId)]
);
