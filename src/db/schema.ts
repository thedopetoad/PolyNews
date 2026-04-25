import {
  pgTable,
  text,
  timestamp,
  real,
  boolean,
  integer,
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
  // Daily-claim streak: number of consecutive days the user has hit the
  // daily claim. Multiplier is min(streak, 7), so each unbroken day
  // earns +100 more (capped at 700/day on day 7+). Resets to 1 on the
  // first claim after a missed day. See lib/daily-streak.ts.
  dailyStreak: integer("daily_streak").notNull().default(0),
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

// Audit log + action queue for leaderboard prize payouts. Each row is
// a frozen snapshot of one winner: week, board, place, user, amount,
// and the CREATE2-derived proxy address at snapshot time.
//
// Workflow:
//   1. Monday 17:00 UTC cron reads weekly leaderboard winners +
//      settings.airdrop_prize_* amounts, inserts rows (status=pending).
//   2. Admin copies proxy addresses from /admin, boss sends USDC.e
//      externally (no keys in our system).
//   3. Admin flips status=paid and optionally records the tx hash.
//
// week_key is the Monday ISO date (e.g. "2026-04-13"). Unique by
// (week_key, leaderboard, place) so a cron re-run can't double-insert.
export const prizePayouts = pgTable(
  "prize_payouts",
  {
    id: text("id").primaryKey(),
    weekKey: text("week_key").notNull(),
    leaderboard: text("leaderboard").notNull(), // "weeklyRef" | "weeklyGain"
    place: integer("place").notNull(), // 1, 2, 3
    userId: text("user_id").notNull().references(() => users.id),
    eoa: text("eoa").notNull(),
    proxyAddress: text("proxy_address").notNull(),
    amountUsdc: real("amount_usdc").notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "paid"
    txHash: text("tx_hash"),
    paidAt: timestamp("paid_at"),
    paidBy: text("paid_by"), // admin pubkey that clicked "mark paid"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("prize_payouts_week_board_place_idx").on(table.weekKey, table.leaderboard, table.place)]
);

// Canonical news feed cache — ensures all users see the same headlines
export const newsCache = pgTable("news_cache", {
  id: text("id").primaryKey(),
  headlines: text("headlines").notNull(), // JSON array of NewsHeadline
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI consensus cache (legacy, on-demand pipeline). Kept while v2 ships in
// parallel; remove once /ai page is fully migrated to consensus_runs.
export const consensusCache = pgTable("consensus_cache", {
  id: text("id").primaryKey(),
  marketQuestion: text("market_question").notNull(),
  result: text("result").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI Consensus v2 — daily snapshot pipeline.
//
// One row per (market, run_date). Cron walks markets through 3 states:
//   step1_pending  - row created, persona-styled web searches not yet done
//   step1_done     - 20 round-1 predictions saved (in consensus_persona_predictions)
//   step2_pending  - waiting for round 2 (re-assess using round-1 context)
//   step2_done     - 40 predictions saved (rounds 1+2)
//   step3_done     - bootstrap math complete, final_mean/mode/CI populated
//   failed         - <15 personas succeeded in step 1, run abandoned
//
// id is `${marketQuestionHash}-${runDate}` so re-running the same day is
// idempotent. Admin "Run Now" deletes the existing row (CASCADE drops the
// child predictions) and re-inserts a fresh one.
export const consensusRuns = pgTable(
  "consensus_runs",
  {
    id: text("id").primaryKey(),
    marketQuestion: text("market_question").notNull(),
    marketQuestionHash: text("market_question_hash").notNull(),
    marketSlug: text("market_slug"),
    eventSlug: text("event_slug"),
    clobTokenIds: text("clob_token_ids"),
    marketEndDate: text("market_end_date"),
    runDate: text("run_date").notNull(), // "2026-04-25" UTC
    yesPriceAtRun: real("yes_price_at_run").notNull(),
    status: text("status").notNull().default("step1_pending"),
    finalMean: real("final_mean"),
    finalMode: real("final_mode"),
    distributionP5: real("distribution_p5"),
    distributionP95: real("distribution_p95"),
    distributionHistogram: text("distribution_histogram"), // JSON array of bin counts
    failureReason: text("failure_reason"), // populated when status='failed'
    triggerSource: text("trigger_source").notNull().default("cron"), // "cron" | "admin"
    createdAt: timestamp("created_at").notNull().defaultNow(),
    step1At: timestamp("step1_at"),
    step2At: timestamp("step2_at"),
    step3At: timestamp("step3_at"),
  },
  (table) => [
    uniqueIndex("consensus_runs_hash_date_idx").on(
      table.marketQuestionHash,
      table.runDate,
    ),
  ],
);

// Per-persona predictions for a given run. 20 rows from round 1 + 20 from
// round 2 = 40 rows per successful run. Round 1 rows include the
// persona-styled web context; round 2 rows don't (they reason off the DB
// snapshot of round 1).
export const consensusPersonaPredictions = pgTable(
  "consensus_persona_predictions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => consensusRuns.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    round: integer("round").notNull(), // 1 or 2
    probability: real("probability").notNull(),
    bulletPoints: text("bullet_points").notNull(), // JSON array of 3-5 strings
    webContext: text("web_context"), // round 1 only — the search summary
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("consensus_predictions_run_persona_round_idx").on(
      table.runId,
      table.persona,
      table.round,
    ),
  ],
);

// YouTube live stream cache
export const youtubeStreamCache = pgTable("youtube_stream_cache", {
  channelId: text("channel_id").primaryKey(),
  channelName: text("channel_name").notNull(),
  streams: text("streams").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Full live Polymarket catalog — refreshed every 6h by /api/cron/catalog-refresh.
// /api/news/markets reads this instead of re-fetching Gamma on every request.
// Rows older than 12h are deleted (closed/delisted markets fall off naturally).
export const marketsCatalog = pgTable("markets_catalog", {
  slug: text("slug").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  question: text("question").notNull(),
  volume: text("volume"),
  endDate: text("end_date"),
  clobTokenIds: text("clob_token_ids"),
  lastTradePrice: real("last_trade_price"),
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
    // Set true when the referrer received the +10k bonus for the
    // referred user's first real-money deposit. Idempotent guard so
    // the deposit endpoint can fire repeatedly without double-paying.
    referralDepositBonusPaid: boolean("referral_deposit_bonus_paid").notNull().default(false),
    // How this referral was attributed. Lets us answer "did people use
    // the link or paste the code?" without inferring from timestamps.
    //   - "signup_link": came in via /?ref=… (URL → cookie → body)
    //   - "oauth_backfill": existing user later visited a ref link and
    //     we back-filled their referredBy on /api/user retry
    //   - "apply_code": user pasted the code into the Earn-tab UI
    //   - "unknown": legacy rows from before this column existed
    source: text("source").notNull().default("unknown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("referrals_referred_id_idx").on(table.referredId)]
);
