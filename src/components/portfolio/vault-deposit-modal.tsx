"use client";

/**
 * Gasless deposit into PolyStreamVault. User signs an EIP-2612 permit over
 * USDC.e, the backend admin relays it via depositWithPermit. Zero gas cost
 * to the user.
 *
 * Prerequisite: user already has USDC.e in their Polygon EOA (either
 * bridged in via the Bridge modal or transferred from elsewhere). If their
 * EOA is empty, we point them at the Bridge modal.
 */
import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccount, useBalance, useSignTypedData } from "wagmi";
import { parseUnits, hexToNumber, type Hex } from "viem";
import { useAuthStore } from "@/stores/use-auth-store";
import { useEnsureWagmi } from "@/hooks/use-ensure-wagmi";

const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const POLYGON_CHAIN_ID = 137;

// USDC.e on Polygon is FiatTokenV2_1 — its EIP-2612 domain is:
//   name: "USD Coin (PoS)", version: "1", chainId: 137, verifyingContract: token
const USDC_E_DOMAIN = {
  name: "USD Coin (PoS)",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
  verifyingContract: USDC_E_ADDRESS,
} as const;

const PERMIT_TYPES = {
  Permit: [
    { name: "owner",    type: "address" },
    { name: "spender",  type: "address" },
    { name: "value",    type: "uint256" },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// FiatTokenV2_1.nonces(owner) selector
const NONCES_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface VaultDepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultAddress: string | null;
  onDeposited?: () => void;
}

export function VaultDepositModal({ open, onOpenChange, vaultAddress, onDeposited }: VaultDepositModalProps) {
  const { address: wagmiAddress } = useAccount();
  const googleAddress = useAuthStore((s) => s.googleAddress);
  const userAddress = wagmiAddress || (googleAddress as `0x${string}` | null) || undefined;
  const ensureWagmi = useEnsureWagmi();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: usdcBalance, refetch: refetchBalance } = useBalance({
    address: userAddress,
    token: USDC_E_ADDRESS,
    chainId: POLYGON_CHAIN_ID,
    query: { enabled: !!userAddress && open, refetchInterval: open ? 5000 : false },
  });
  const balance = usdcBalance ? parseFloat(usdcBalance.formatted) : 0;

  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ txHash: string } | null>(null);

  const amountNum = parseFloat(amount || "0");
  const validAmount = amountNum > 0 && amountNum <= balance + 0.000001;

  const handleMax = useCallback(() => {
    const floored = Math.floor(balance * 1_000_000) / 1_000_000;
    setAmount(floored.toString());
  }, [balance]);

  const handleDeposit = useCallback(async () => {
    if (!userAddress || !vaultAddress || !validAmount) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await ensureWagmi();

      const amountSmallest = parseUnits(amount, 6);

      // Fetch the user's current nonce on USDC.e (changes every time permit
      // is used). Read via viem's readContract through wagmi's injected
      // provider — simplest way from a hook-light context is a fetch to
      // Polygon RPC.
      const nonceRes = await fetch("https://polygon.drpc.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: USDC_E_ADDRESS,
              // nonces(address) selector + padded address
              data: "0x7ecebe00" + userAddress.slice(2).padStart(64, "0").toLowerCase(),
            },
            "latest",
          ],
        }),
      }).then((r) => r.json());
      if (nonceRes.error) throw new Error(`Nonce fetch failed: ${nonceRes.error.message}`);
      const nonce = hexToNumber(nonceRes.result as Hex);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 30;   // 30 min expiry

      const signature = await signTypedDataAsync({
        domain: USDC_E_DOMAIN,
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: userAddress,
          spender: vaultAddress as `0x${string}`,
          value: amountSmallest,
          nonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
      });

      // Decompose the 65-byte signature into r, s, v
      const sigHex = signature.slice(2);               // strip 0x
      const r = `0x${sigHex.slice(0, 64)}` as Hex;
      const s = `0x${sigHex.slice(64, 128)}` as Hex;
      let v = parseInt(sigHex.slice(128, 130), 16);
      if (v < 27) v += 27;

      const res = await fetch("/api/vault/deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userAddress}`,
        },
        body: JSON.stringify({
          userId: userAddress,
          amount: amountSmallest.toString(),
          deadline,
          v,
          r,
          s,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Vault deposit failed");

      setSuccess({ txHash: data.txHash });
      setAmount("");
      refetchBalance();
      onDeposited?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [userAddress, vaultAddress, amount, validAmount, ensureWagmi, signTypedDataAsync, refetchBalance, onDeposited]);

  const handleClose = (next: boolean) => {
    if (!next) {
      setAmount("");
      setError(null);
      setSuccess(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-[#21262d] bg-[#161b22] sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-white text-base">Deposit to Vault</DialogTitle>
          <p className="text-xs text-[#768390]">Gasless — you sign a permit, PolyStream pays the tx</p>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-3">
            <div className="flex items-center justify-between text-[10px] text-[#484f58] uppercase tracking-wider mb-1">
              <span>Available in wallet</span>
              <span>USDC.e · Polygon</span>
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">
              {balance.toFixed(6)} <span className="text-sm font-normal text-[#768390]">USDC.e</span>
            </p>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-white mb-1.5 block">Amount to deposit</label>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5 focus-within:border-[#58a6ff]">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="flex-1 bg-transparent text-xl font-medium text-white placeholder:text-[#484f58] focus:outline-none tabular-nums"
                />
                <span className="text-xs font-semibold text-[#768390]">USDC.e</span>
                <button
                  onClick={handleMax}
                  className="text-[10px] font-semibold text-[#58a6ff] hover:text-[#79c0ff] bg-[#58a6ff]/10 rounded px-1.5 py-0.5"
                >
                  Max
                </button>
              </div>
            </div>
          </div>

          {balance < 0.01 && (
            <div className="rounded-lg bg-[#d29922]/10 border border-[#d29922]/30 px-3 py-2 text-[11px] text-[#d29922] leading-snug">
              No USDC.e in your Polygon wallet. Use the <strong>Bridge</strong> button first to bring funds over from another chain.
            </div>
          )}

          {error && <p className="text-[11px] text-[#f85149]">{error}</p>}
          {success && (
            <div className="text-[11px] text-[#3fb950] bg-[#3fb950]/10 px-3 py-2 rounded-lg">
              Deposited!{" "}
              <a href={`https://polygonscan.com/tx/${success.txHash}`} target="_blank" rel="noopener noreferrer" className="underline">
                View on Polygonscan →
              </a>
            </div>
          )}

          <button
            onClick={handleDeposit}
            disabled={!validAmount || submitting || !userAddress || !vaultAddress}
            className="w-full py-3 rounded-lg text-sm font-semibold bg-[#58a6ff] text-white hover:bg-[#4d8fea] transition-colors disabled:bg-[#21262d] disabled:text-[#484f58] disabled:cursor-not-allowed"
          >
            {!vaultAddress ? "Vault not configured" : submitting ? "Signing permit…" : !validAmount ? "Enter amount" : "Sign & deposit"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
