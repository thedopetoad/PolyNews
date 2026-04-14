"use client";

/**
 * Deposit modal backed by bridge.polymarket.com — the exact same bridge
 * polymarket.com's own UI uses. Public, no API key, deterministic per user.
 *
 * Flow:
 *   1. POST bridge.polymarket.com/deposit { address: <user EOA> }
 *      → returns deposit addresses for EVM, SVM, Tron, BTC (unique per user)
 *   2. GET  bridge.polymarket.com/supported-assets
 *      → list of { chainId, chainName, token: {name, symbol, address, decimals}, minCheckoutUsd }
 *   3. User picks chain + token → we display the right deposit address +
 *      QR code. They send from their own wallet/CEX. Polymarket's bridge
 *      sweeps on detection and settles to the user's Polymarket proxy
 *      wallet on Polygon (as USDC.e).
 *
 * Zero signatures from the user. Zero gas. Works for brand-new wallets.
 * This is the polystream equivalent of Polymarket's native deposit UI.
 */
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deriveProxyAddress } from "@/lib/relay";

const BRIDGE_API = "https://bridge.polymarket.com";

interface SupportedAsset {
  chainId: string;
  chainName: string;
  token: { name: string; symbol: string; address: string; decimals: number };
  minCheckoutUsd: number;
}

interface DepositAddresses {
  evm: string;
  svm: string;
  tron: string;
  btc: string;
}

// Map supported-assets chainId → which address field from /deposit applies
function chainKindFor(chainId: string): keyof DepositAddresses {
  // Chains that use native BTC format
  if (chainId === "8253038") return "btc";
  // Tron
  if (chainId === "728126428") return "tron";
  // Solana — Polymarket uses a non-standard chainId for Solana in this API
  if (chainId === "1151111081099710") return "svm";
  // Everything else is EVM (Ethereum 1, Polygon 137, Base 8453, Arbitrum 42161,
  // Optimism 10, BSC 56, Monad 143, HyperEVM 999, Abstract 2741, Ethereal 5064014, ...)
  return "evm";
}

// Chain icons — reuse Relay's CDN (Polymarket's bridge returns no logos).
// Map Polymarket bridge's chain IDs to their common chain ID for icon lookup.
function chainIcon(chainId: string): string {
  const iconChainId = chainId === "1151111081099710" ? 792703809 : Number(chainId);
  return `https://assets.relay.link/icons/${iconChainId}/light.png`;
}

interface BridgeDepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User's EVM address (Magic / RainbowKit) — used to fetch their unique deposit addresses */
  recipientAddress: string | null;
}

export function BridgeDepositModal({ open, onOpenChange, recipientAddress }: BridgeDepositModalProps) {
  const [assets, setAssets] = useState<SupportedAsset[] | null>(null);
  const [addresses, setAddresses] = useState<DepositAddresses | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Selection state — default to Ethereum USDC which matches Polymarket's own default
  const [selectedChainId, setSelectedChainId] = useState<string>("1");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("USDC");
  const [chainMenuOpen, setChainMenuOpen] = useState(false);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);

  // Fetch supported assets + deposit addresses when modal opens
  // Pass the PROXY wallet address to the bridge — Polymarket deposits should
  // land in the proxy wallet (CREATE2 derived), not the EOA directly.
  useEffect(() => {
    if (!open || !recipientAddress) return;
    const proxyAddr = deriveProxyAddress(recipientAddress);
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${BRIDGE_API}/supported-assets`).then((r) => r.json()),
      fetch(`${BRIDGE_API}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: proxyAddr }),
      }).then((r) => r.json()),
    ])
      .then(([assetsData, depositData]) => {
        if (cancelled) return;
        setAssets(assetsData.supportedAssets || []);
        setAddresses(depositData.address || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`Failed to load bridge info: ${(err as Error).message}`);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [open, recipientAddress]);

  // Unique chains in supported-assets list, ordered to surface the popular ones
  const chains = useMemo(() => {
    if (!assets) return [];
    const seen = new Map<string, { chainId: string; chainName: string }>();
    for (const a of assets) {
      if (!seen.has(a.chainId)) seen.set(a.chainId, { chainId: a.chainId, chainName: a.chainName });
    }
    const order = ["1", "137", "8453", "42161", "10", "56", "1151111081099710", "8253038", "728126428", "143", "999", "2741", "5064014"];
    return [...seen.values()].sort((a, b) => {
      const ai = order.indexOf(a.chainId);
      const bi = order.indexOf(b.chainId);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [assets]);

  const tokensForSelectedChain = useMemo(() => {
    if (!assets) return [];
    return assets.filter((a) => a.chainId === selectedChainId);
  }, [assets, selectedChainId]);

  // When chain changes, reset token to first available for that chain
  useEffect(() => {
    if (tokensForSelectedChain.length === 0) return;
    const match = tokensForSelectedChain.find((t) => t.token.symbol === selectedSymbol);
    if (!match) setSelectedSymbol(tokensForSelectedChain[0].token.symbol);
  }, [selectedChainId, tokensForSelectedChain, selectedSymbol]);

  const selectedAsset = tokensForSelectedChain.find((t) => t.token.symbol === selectedSymbol);
  const selectedChainName = chains.find((c) => c.chainId === selectedChainId)?.chainName || "";
  const depositAddress = addresses ? addresses[chainKindFor(selectedChainId)] : null;

  const handleCopy = useCallback(() => {
    if (!depositAddress) return;
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [depositAddress]);

  const handleClose = (next: boolean) => {
    if (!next) {
      setChainMenuOpen(false);
      setTokenMenuOpen(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Transfer Crypto</DialogTitle>
          <p className="text-xs text-[#768390]">Funds settle to your Polymarket account as USDC.e on Polygon</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          {/* Token + Chain dropdowns */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-[11px] font-semibold text-white mb-1.5 block">Supported token</label>
              <button
                type="button"
                onClick={() => { setTokenMenuOpen((v) => !v); setChainMenuOpen(false); }}
                disabled={loading || !assets}
                className="w-full flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white hover:border-[#484f58] transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <TokenGlyph symbol={selectedSymbol} />
                  <span className="font-medium">{selectedSymbol}</span>
                </span>
                <ChevronDown />
              </button>
              {tokenMenuOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {tokensForSelectedChain.map((t) => (
                    <button
                      key={`${t.chainId}-${t.token.symbol}-${t.token.address}`}
                      onClick={() => { setSelectedSymbol(t.token.symbol); setTokenMenuOpen(false); }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-white hover:bg-[#21262d] transition-colors text-left"
                    >
                      <span className="flex items-center gap-2">
                        <TokenGlyph symbol={t.token.symbol} />
                        <span className="font-medium">{t.token.symbol}</span>
                      </span>
                      <span className="text-[10px] text-[#484f58]">Min ${t.minCheckoutUsd}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-white">Supported chain</label>
                {selectedAsset && <span className="text-[10px] text-[#484f58]">Min ${selectedAsset.minCheckoutUsd}</span>}
              </div>
              <button
                type="button"
                onClick={() => { setChainMenuOpen((v) => !v); setTokenMenuOpen(false); }}
                disabled={loading || !assets}
                className="w-full flex items-center justify-between bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-sm text-white hover:border-[#484f58] transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <ChainGlyph src={chainIcon(selectedChainId)} alt={selectedChainName} />
                  <span className="font-medium">{selectedChainName}</span>
                </span>
                <ChevronDown />
              </button>
              {chainMenuOpen && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {chains.map((c) => (
                    <button
                      key={c.chainId}
                      onClick={() => { setSelectedChainId(c.chainId); setChainMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white hover:bg-[#21262d] transition-colors text-left"
                    >
                      <ChainGlyph src={chainIcon(c.chainId)} alt={c.chainName} />
                      <span className="font-medium">{c.chainName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* QR code */}
          <div className="rounded-xl bg-[#0d1117] border border-[#30363d] p-6 flex items-center justify-center">
            {!recipientAddress ? (
              <div className="w-[192px] h-[192px] flex items-center justify-center text-xs text-[#484f58] text-center px-4">
                Log in to generate deposit address
              </div>
            ) : loading ? (
              <div className="w-[192px] h-[192px] flex items-center justify-center text-xs text-[#484f58]">
                Generating address…
              </div>
            ) : error ? (
              <div className="w-[192px] h-[192px] flex items-center justify-center text-xs text-[#f85149] text-center px-4">
                {error}
              </div>
            ) : depositAddress ? (
              <div className="p-3 bg-white rounded-lg">
                <QRCodeSVG value={depositAddress} size={168} level="M" marginSize={0} />
              </div>
            ) : (
              <div className="w-[192px] h-[192px]" />
            )}
          </div>

          {/* Address */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-semibold text-white">Your deposit address</label>
              <span className="text-[10px] text-[#484f58]">Terms apply</span>
            </div>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 text-[11px] text-[#adbac7] font-mono break-all">
              {depositAddress || (loading ? "Generating…" : "—")}
            </div>
            <button
              onClick={handleCopy}
              disabled={!depositAddress}
              className="w-full mt-2 flex items-center justify-center gap-2 bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-xs font-medium transition-colors"
            >
              <CopyIcon />
              {copied ? "Copied!" : "Copy address"}
            </button>
          </div>

          <div className="text-[10px] text-[#484f58] leading-snug">
            Send {selectedSymbol} on {selectedChainName} to this address. Funds auto-bridge to your Polymarket balance as USDC.e on Polygon via bridge.polymarket.com — usually under a minute.
            {selectedAsset && <> Minimum ≈ ${selectedAsset.minCheckoutUsd}.</>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── tiny helper glyphs ──────────────────────────────────────────────────────
function ChainGlyph({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="w-6 h-6 rounded-full bg-[#21262d] overflow-hidden flex-shrink-0">
      <Image src={src} alt={alt} width={24} height={24} unoptimized className="w-6 h-6 object-cover" />
    </span>
  );
}

function TokenGlyph({ symbol }: { symbol: string }) {
  // Stablecoins share the same logo — use the CoinGecko USDC for USDC/USDC.e/USDT/DAI.
  const USDC_LOGO = "https://coin-images.coingecko.com/coins/images/6319/large/usdc.png";
  const USDT_LOGO = "https://coin-images.coingecko.com/coins/images/325/large/Tether.png";
  const isUsdc = symbol === "USDC" || symbol === "USDC.e" || symbol === "USDCET";
  const isUsdt = symbol === "USDT" || symbol === "USD₮0" || symbol === "USDT0";
  if (isUsdc || isUsdt) {
    return (
      <span className="w-6 h-6 rounded-full bg-[#21262d] overflow-hidden flex-shrink-0">
        <Image src={isUsdc ? USDC_LOGO : USDT_LOGO} alt={symbol} width={24} height={24} unoptimized className="w-6 h-6 object-cover" />
      </span>
    );
  }
  // Fallback: first letter in a circle
  return (
    <span className="w-6 h-6 rounded-full bg-[#21262d] flex items-center justify-center text-[10px] font-semibold text-[#adbac7]">
      {symbol[0]}
    </span>
  );
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#768390]">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}
