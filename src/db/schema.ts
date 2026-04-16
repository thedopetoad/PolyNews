import {
  pgTable,
  text,
  timestamp,
  real,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Users - identified by wallet address or OAuth ID
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  email: text("email"),
  authMethod: text("auth_method").notNull(),
  walletAddress: text("wallet_address"),
  referralCode: text("referral_code").notNull().unique(),
  referredBy: text("referred_by"),
  balance: real("balance").notNull().default(10000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at").notNull().defaultNow(),
  lastDailyAirdrop: text("last_daily_airdrop"),
  lastWeeklyAirdrop: text("last_weekly_airdrop"),
  hasSignupAirdrop: boolean("has_signup_airdrop").notNull().default(false),
  signupIp: text("signup_ip"),
});

// Trading positions — paper (AIRDROP) and real (USDC) alike.
// tradeType: "paper" (default, legacy) or "real" (actual CLOB orders).
export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  marketId: text("market_id").notNull(),
  marketQuestion: text("market_question").notNull(),
  outcome: text("outcome").notNull(),
  shares: real("shares").notNull(),
  avgPrice: real("avg_price").notNull(),
  clobTokenId: text("clob_token_id"),
  marketEndDate: text("market_end_date"),
  eventSlug: text("event_slug"),
  tradeType: text("trade_type").notNull().default("paper"),
  clobOrderId: text("clob_order_id"),
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
  side: text("side").notNull(),
  shares: real("shares").notNull(),
  price: real("price").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Airdrop records
export const airdrops = pgTable("airdrops", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  source: text("source").notNull(),
  amount: real("amount").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Canonical news feed cache — ensures all users see the same headlines
export const newsCache = pgTable("news_cache", {
  id: text("id").primaryKey(),
  headlines: text("headlines").notNull(), // JSON array of NewsHeadline
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI consensus cache
export const consensusCache = pgTable("consensus_cache", {
  id: text("id").primaryKey(),
  marketQuestion: text("market_question").notNull(),
  result: text("result").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// YouTube live stream cache
export const youtubeStreamCache = pgTable("youtube_stream_cache", {
  channelId: text("channel_id").primaryKey(),
  channelName: text("channel_name").notNull(),
  streams: text("streams").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
