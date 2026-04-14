/**
 * Relay Protocol API client
 * Docs: https://docs.relay.link/
 *
 * Polymarket uses Relay (by Reservoir) for all cross-chain deposits and
 * withdrawals. Relay has pre-funded liquidity on every chain — quotes are
 * deterministic, no route-shopping, works at any amount.
 *
 * Two flows:
 *   - Deposit: generate a deposit address (useDepositAddress=true), user sends
 *     funds to it from any chain, Relay bridges them to our Polygon wallet.
 *   - Withdraw: fetch a normal quote, execute the returned steps (approve +
 *     deposit) against the user's wallet; Relay fills on the destination chain.
 */
const RELAY_API = "https://api.relay.link";

// USDC.e on Polygon — REQUIRED for Polymarket CLOB (their sports + prediction
// markets use USDC.e as collateral). We briefly tried native USDC for a fully
// gasless flow, but orders against Polymarket's CLOB reject native USDC —
// users must hold USDC.e on-chain. Relay's usePermit gives us a hybrid path:
// first withdrawal needs a one-time `approve` tx (~$0.02 gas, covered by
// topupGas on the prior deposit), then all subsequent withdrawals are gasless
// EIP-3009 signatures.
export const POLYGON_USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
export const POLYGON_CHAIN_ID = 137;

// Zero address = native token (ETH, MATIC, SOL, BTC, etc.)
export const NATIVE = "0x0000000000000000000000000000000000000000";

// ── Supported chains shown in the modals ────────────────────────────────────
// Order matches Polymarket's deposit dropdown. `min` is the minimum USD value
// Relay recommends per route (informational; actual min is enforced by Relay).
export interface SupportedChain {
  id: number;
  name: string;          // display name
  shortName: string;     // short label for pills
  min: number;           // informational min USD
  kind: "evm" | "svm" | "btc";
  icon: string;          // Relay CDN logo URL
}

/** Relay serves chain logos at this CDN — matches their explorer/branding. */
function relayChainIcon(id: number): string {
  return `https://assets.relay.link/icons/${id}/light.png`;
}

export const SUPPORTED_CHAINS: SupportedChain[] = [
  { id: 1,           name: "Ethereum", shortName: "ETH",   min: 10, kind: "evm", icon: relayChainIcon(1) },
  { id: 792703809,   name: "Solana",   shortName: "SOL",   min: 3,  kind: "svm", icon: relayChainIcon(792703809) },
  { id: 56,          name: "BSC",      shortName: "BSC",   min: 3,  kind: "evm", icon: relayChainIcon(56) },
  { id: 8453,        name: "Base",     shortName: "BASE",  min: 3,  kind: "evm", icon: relayChainIcon(8453) },
  { id: 137,         name: "Polygon",  shortName: "MATIC", min: 3,  kind: "evm", icon: relayChainIcon(137) },
  { id: 42161,       name: "Arbitrum", shortName: "ARB",   min: 3,  kind: "evm", icon: relayChainIcon(42161) },
  { id: 10,          name: "Optimism", shortName: "OP",    min: 3,  kind: "evm", icon: relayChainIcon(10) },
  { id: 728126428,   name: "Tron",     shortName: "TRX",   min: 10, kind: "evm", icon: relayChainIcon(728126428) },
  { id: 8253038,     name: "Bitcoin",  shortName: "BTC",   min: 10, kind: "btc", icon: relayChainIcon(8253038) },
  { id: 143,         name: "Monad",    shortName: "MON",   min: 3,  kind: "evm", icon: relayChainIcon(143) },
  { id: 999,         name: "HyperEVM", shortName: "HYPE",  min: 3,  kind: "evm", icon: relayChainIcon(999) },
];

// ── Supported tokens per chain ──────────────────────────────────────────────
// Token addresses on each chain. `native` uses 0x0 address.
export interface SupportedToken {
  symbol: string;       // display
  address: string;      // on-chain address (or 0x0 for native)
  decimals: number;
  chainIds: number[];   // chains where this token symbol is available
  icon: string;         // logo URL
}

// Well-known logo URLs. For native tokens we reuse Relay's chain icon since
// ETH/SOL/MATIC/BNB/BTC are visually the same as their respective chains.
const USDC_LOGO = "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png";

// USDC addresses per chain for common networks. We restrict the deposit/withdraw
// token picker to well-known, liquid tokens that work with Relay's solver.
const USDC_BY_CHAIN: Record<number, string> = {
  1:         "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",                           // Ethereum USDC
  137:       "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",                           // Polygon native USDC
  8453:      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",                           // Base USDC
  42161:     "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",                           // Arbitrum USDC
  10:        "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",                           // Optimism USDC
  56:        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",                           // BSC USDC
  792703809: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",                         // Solana USDC
};

export function getUsdcAddress(chainId: number): string | null {
  return USDC_BY_CHAIN[chainId] || null;
}

/**
 * For each chain, list the popular tokens the user can pick.
 * USDC is always preferred (native routing via CCTP). Native token is second.
 */
export function tokensForChain(chainId: number): SupportedToken[] {
  const tokens: SupportedToken[] = [];
  const usdc = USDC_BY_CHAIN[chainId];
  if (usdc) {
    tokens.push({
      symbol: "USDC",
      address: usdc,
      decimals: 6,
      chainIds: [chainId],
      icon: USDC_LOGO,
    });
  }
  // Native token for the chain — icon reuses Relay's chain logo
  const chainIcon = relayChainIcon(chainId);
  switch (chainId) {
    case 1:
    case 8453:
    case 42161:
    case 10:
      tokens.push({ symbol: "ETH", address: NATIVE, decimals: 18, chainIds: [chainId], icon: relayChainIcon(1) });
      break;
    case 137:
      // Native USDC is already added above from USDC_BY_CHAIN.
      tokens.push({ symbol: "MATIC", address: NATIVE, decimals: 18, chainIds: [137], icon: chainIcon });
      break;
    case 56:
      tokens.push({ symbol: "BNB", address: NATIVE, decimals: 18, chainIds: [56], icon: chainIcon });
      break;
    case 792703809:
      tokens.push({ symbol: "SOL", address: "11111111111111111111111111111111", decimals: 9, chainIds: [792703809], icon: chainIcon });
      break;
    case 8253038:
      tokens.push({ symbol: "BTC", address: NATIVE, decimals: 8, chainIds: [8253038], icon: chainIcon });
      break;
    case 728126428:
      tokens.push({ symbol: "TRX", address: NATIVE, decimals: 6, chainIds: [728126428], icon: chainIcon });
      break;
    case 143:
      tokens.push({ symbol: "MON", address: NATIVE, decimals: 18, chainIds: [143], icon: chainIcon });
      break;
    case 999:
      tokens.push({ symbol: "HYPE", address: NATIVE, decimals: 18, chainIds: [999], icon: chainIcon });
      break;
  }
  return tokens;
}

// ── API types ───────────────────────────────────────────────────────────────
export interface RelayQuoteParams {
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;               // smallest unit as string
  tradeType?: "EXACT_INPUT" | "EXACT_OUTPUT" | "EXPECTED_OUTPUT";
  useDepositAddress?: boolean;
  refundTo?: string;
  slippageTolerance?: string;   // basis points as string
  /** When true, Relay sends a small amount of destination-chain gas token
   * (e.g. MATIC on Polygon) alongside the bridged funds so the recipient can
   * pay for subsequent transactions. Critical for Magic/Google users who
   * otherwise land with 0 MATIC and can't do anything on-chain. */
  topupGas?: boolean;
  topupGasAmount?: string;
  /** Gasless withdrawal flow for permit-compatible tokens (native USDC via
   * EIP-3009 TransferWithAuthorization). User signs an off-chain message; the
   * returned `signature` step is POSTed back to /execute/permits and Relay's
   * solver does the on-chain transfer at their own expense (fee deducted from
   * the bridged amount). */
  usePermit?: boolean;
}

export interface RelayQuote {
  steps: RelayStep[];
  fees?: {
    gas?: RelayFee;
    relayer?: RelayFee;
    relayerService?: RelayFee;
    app?: RelayFee;
  };
  details?: {
    operation?: string;
    sender?: string;
    recipient?: string;
    currencyIn?: RelayCurrencyAmount;
    currencyOut?: RelayCurrencyAmount;
    totalImpact?: { usd?: string; percent?: string };
    slippageTolerance?: { origin?: { percent?: string }; destination?: { percent?: string } };
  };
  protocol?: unknown;
}

export interface RelayStep {
  id: string;
  action?: string;
  description?: string;
  kind: "transaction" | "signature";
  items?: RelayStepItem[];
  depositAddress?: string;
  requestId?: string;
}

export interface RelayStepItem {
  status: "incomplete" | "complete";
  data: {
    // For EVM transactions
    from?: string;
    to?: string;
    value?: string;
    data?: string;
    chainId?: number;
    // For Solana — pre-built instructions the user signs via their wallet
    instructions?: unknown[];
    // Deposit-address flow
    depositAddress?: string;
  };
  check?: {
    endpoint: string;
    method: string;
  };
}

export interface RelayFee {
  currency?: { symbol?: string; decimals?: number };
  amount?: string;
  amountFormatted?: string;
  amountUsd?: string;
}

export interface RelayCurrencyAmount {
  currency?: { symbol?: string; decimals?: number; address?: string; chainId?: number };
  amount?: string;
  amountFormatted?: string;
  amountUsd?: string;
}

// ── API calls ───────────────────────────────────────────────────────────────
/**
 * Fetch a quote. For withdrawals, the returned `steps` are what the user must
 * sign/send. For deposits, pass `useDepositAddress: true` to get back an
 * address the user can fund directly.
 */
export async function getRelayQuote(params: RelayQuoteParams): Promise<RelayQuote> {
  const res = await fetch(`${RELAY_API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tradeType: "EXACT_INPUT",
      ...params,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Relay quote failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Pull a deposit address out of a Relay deposit-address quote.
 * Relay puts it on the first step's `depositAddress`, or on the first item's
 * `data.depositAddress` / `data.to` depending on API version.
 */
export function extractDepositAddress(quote: RelayQuote): string | null {
  const step = quote.steps?.[0];
  if (!step) return null;
  if (step.depositAddress) return step.depositAddress;
  const item = step.items?.[0];
  if (!item) return null;
  return item.data.depositAddress || item.data.to || null;
}

/**
 * Submit a signed EIP-3009/EIP-712 permit back to Relay. After a `usePermit`
 * quote the user signs the TransferWithAuthorization message off-chain; this
 * posts the signature to Relay's `/execute/permits` endpoint which kicks off
 * their solver to do the on-chain transfer (they pay gas, fee already deducted
 * from `details.currencyOut.amount`).
 */
export async function submitRelayPermit(params: {
  signature: string;
  kind: string;                 // e.g. "eip3009"
  requestId: string;
  api: "bridge" | "swap" | "user-swap";
}): Promise<{ success: boolean; raw: unknown }> {
  const { signature, ...body } = params;
  const res = await fetch(`${RELAY_API}/execute/permits?signature=${encodeURIComponent(signature)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Relay permit submit failed (${res.status}): ${data?.message || JSON.stringify(data)}`);
  }
  return { success: true, raw: data };
}

/**
 * Poll a step's `check` endpoint until it's complete or errors.
 * Returns the final status response.
 */
export async function pollStepStatus(
  checkEndpoint: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<{ status: string; txHashes?: string[] }> {
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${RELAY_API}${checkEndpoint}`);
    if (res.ok) {
      const data = await res.json();
      const status = data.status || data.state;
      if (status === "success" || status === "delivered" || status === "complete") {
        return { status: "success", txHashes: data.txHashes };
      }
      if (status === "failure" || status === "refund" || status === "failed") {
        return { status: "failed", txHashes: data.txHashes };
      }
    }
    if (Date.now() - started > timeout) {
      return { status: "timeout" };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Build a Solana VersionedTransaction from a Relay deposit step. Relay returns
 * an array of instruction objects (hex-encoded data + pubkey arrays) plus a
 * list of address-lookup-table addresses. We fetch each lookup table, compile
 * a v0 message, and return a ready-to-sign transaction.
 */
export async function buildRelaySolanaTx(
  connection: import("@solana/web3.js").Connection,
  payer: import("@solana/web3.js").PublicKey,
  stepData: { instructions?: unknown[]; addressLookupTableAddresses?: string[] }
): Promise<import("@solana/web3.js").VersionedTransaction> {
  const { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");

  type RawInstr = {
    keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    programId: string;
    data: string;                // hex
  };
  const raw = (stepData.instructions || []) as RawInstr[];

  const instructions = raw.map((ins) => new TransactionInstruction({
    keys: ins.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    programId: new PublicKey(ins.programId),
    data: Buffer.from(ins.data, "hex"),
  }));

  // Fetch lookup tables (needed for v0 compressed messages)
  const lookupAddrs = stepData.addressLookupTableAddresses || [];
  const lookupTables = await Promise.all(
    lookupAddrs.map(async (addr) => {
      const res = await connection.getAddressLookupTable(new PublicKey(addr));
      return res.value;
    })
  );
  const validTables = lookupTables.filter((t): t is NonNullable<typeof t> => !!t);

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(validTables);

  return new VersionedTransaction(msg);
}

/**
 * Display-format a smallest-unit amount as "1.2345" using the token's decimals.
 */
export function formatAmount(amountSmallestUnit: string | undefined, decimals: number): string {
  if (!amountSmallestUnit) return "0";
  const n = BigInt(amountSmallestUnit);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
