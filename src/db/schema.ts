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
  // One-time airdrop boost flags
  firstDepositBonusPaid: boolean("first_deposit_bonus_paid").notNull().default(false),
  firstSportsTradeBonusPaid: boolean("first_sports_trade_bonus_paid").notNull().default(false),
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

// Airdrop records.
// `source` values: signup | daily | referral | referral_first_trade |
//                  news_watch_weekly | paper_trades_weekly |
//                  first_deposit | first_sports_trade | leaderboard_prize
// `weekKey` is ISO week ("2026-W16") — used for weekly leaderboards and
// for idempotency on recurring weekly goals. Nullable for legacy rows
// created before this column existed; new inserts should always set it.
export const airdrops = pgTable("airdrops", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  source: text("source").notNull(),
  amount: real("amount").notNull(),
  weekKey: text("week_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Heartbeats posted by the news page while the tab is visible. Each row
// is a 15-second bucket; a full 5-minute claim requires 20 distinct
// buckets in the same ISO week. Unique(userId, bucket) prevents spam.
export const newsWatchHeartbeats = pgTable(
  "news_watch_heartbeats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    bucket: text("bucket").notNull(), // "2026-W16-042871" (week + 15s index)
    weekKey: text("week_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("news_heartbeat_user_bucket_idx").on(table.userId, table.bucket)]
);

// Admin-editable key/value settings (leaderboard prizes, etc.)
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
