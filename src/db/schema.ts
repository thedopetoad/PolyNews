import {
  pgTable,
  text,
  timestamp,
  real,
  boolean,
  bigint,
  uniqueIndex,
  index,
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

// Paper trading positions
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

// ─── Custody vault ─────────────────────────────────────────────────────────
// Mirror of PolyStreamVault on-chain state. Source of truth for the user's
// "real money" balance shown in the portfolio. Reconciled against on-chain
// events by /api/vault/sync.
export const vaultBalances = pgTable("vault_balances", {
  userId: text("user_id").primaryKey().references(() => users.id),
  // Balance in USDC.e smallest units (6 decimals). Stored as text to preserve
  // full uint256 precision; JS BigInt handles arithmetic.
  balance: text("balance").notNull().default("0"),
  totalDeposited: text("total_deposited").notNull().default("0"),
  totalWithdrawn: text("total_withdrawn").notNull().default("0"),
  maticDispensed: text("matic_dispensed").notNull().default("0"),
  hasMaticAirdrop: boolean("has_matic_airdrop").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Every on-chain vault event indexed from the contract. Idempotent via
// (txHash, logIndex) unique constraint — re-running the indexer is safe.
export const vaultEvents = pgTable(
  "vault_events",
  {
    id: text("id").primaryKey(),                    // `${txHash}-${logIndex}`
    kind: text("kind").notNull(),                   // deposit | withdrawal | matic_dispensed
    userId: text("user_id"),                        // nullable: not all events tie to a user row (e.g. if user doesn't exist yet in DB)
    // Amount in smallest units (USDC.e for deposit/withdrawal, wei for matic).
    amount: text("amount").notNull(),
    // For withdrawals: the off-vault destination address. For deposits: sender.
    counterparty: text("counterparty"),
    // For withdrawals: the bytes32 withdrawId correlated with a DB withdrawal record.
    withdrawId: text("withdraw_id"),
    txHash: text("tx_hash").notNull(),
    logIndex: bigint("log_index", { mode: "number" }).notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockTimestamp: timestamp("block_timestamp"),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vault_events_tx_log_idx").on(table.txHash, table.logIndex),
    index("vault_events_user_idx").on(table.userId),
    index("vault_events_kind_idx").on(table.kind),
  ]
);

// Pending withdrawal intents — user clicks Withdraw, backend queues an intent,
// admin tx broadcasts it and flips status. Acts as idempotency key so a retry
// doesn't double-pay.
export const vaultWithdrawals = pgTable(
  "vault_withdrawals",
  {
    id: text("id").primaryKey(),                    // also used as on-chain withdrawId (bytes32 = keccak(id))
    userId: text("user_id").notNull().references(() => users.id),
    amount: text("amount").notNull(),               // USDC.e smallest units
    toAddress: text("to_address").notNull(),
    toChainId: bigint("to_chain_id", { mode: "number" }).notNull(),
    // If crossing chains, we withdraw USDC.e from vault to Relay's depository
    // via an admin-signed approve+deposit, so this field stores the Relay
    // quote's requestId. If same-chain (Polygon USDC.e), this is null.
    relayRequestId: text("relay_request_id"),
    status: text("status").notNull().default("pending"),  // pending | signing | broadcast | confirmed | failed
    txHash: text("tx_hash"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("vault_withdrawals_user_idx").on(table.userId),
    index("vault_withdrawals_status_idx").on(table.status),
  ]
);

// Cursor for the event indexer — last processed block, so incremental polls
// don't re-scan from genesis.
export const vaultSyncState = pgTable("vault_sync_state", {
  id: text("id").primaryKey(),                      // always "singleton"
  lastProcessedBlock: bigint("last_processed_block", { mode: "number" }).notNull().default(0),
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
