import { NextRequest, NextResponse } from "next/server";

// GET /api/portfolio/bridge-history?user=<proxyAddress>
//
// Returns USDC.e ERC-20 transfer events touching the given proxy
// wallet, pulled from Polygonscan. The client then subtracts any
// tx hashes that match Polymarket's /activity feed — the leftovers
// are bridge deposits (USDC.e coming in) and withdraws (going out).
//
// POLYGONSCAN_API_KEY env var is optional. Without it Polygonscan
// still responds but applies a tighter rate limit. Works fine for
// the single-user-checking-their-own-portfolio case.

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

interface PolygonscanTokenTx {
  hash: string;
  from: string;
  to: string;
  value: string; // stringified uint
  timeStamp: string; // seconds, stringified
  blockNumber: string;
  contractAddress: string;
  tokenDecimal: string;
}

interface BridgeTx {
  type: "deposit" | "withdraw";
  amountUsdc: number;
  timestamp: number; // ms
  txHash: string;
  counterparty: string;
}

export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user");
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
    return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  }

  const apiKey = process.env.POLYGONSCAN_API_KEY || "";
  const url =
    `https://api.polygonscan.com/api` +
    `?module=account&action=tokentx` +
    `&contractaddress=${USDC_E}` +
    `&address=${user.toLowerCase()}` +
    `&page=1&offset=100&sort=desc` +
    (apiKey ? `&apikey=${apiKey}` : "");

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ bridges: [] });
    const data = (await res.json()) as { status?: string; result?: PolygonscanTokenTx[] | string };
    // Polygonscan returns status "0" + result as a string message when no
    // results OR rate-limited. Treat both as empty-no-error.
    if (data.status !== "1" || !Array.isArray(data.result)) {
      return NextResponse.json({ bridges: [] });
    }

    const userLower = user.toLowerCase();
    const bridges: BridgeTx[] = data.result.map((tx) => {
      const isDeposit = tx.to.toLowerCase() === userLower;
      // USDC.e has 6 decimals.
      const amount = Number(tx.value) / 1_000_000;
      return {
        type: isDeposit ? "deposit" : "withdraw",
        amountUsdc: amount,
        timestamp: Number(tx.timeStamp) * 1000,
        txHash: tx.hash,
        counterparty: isDeposit ? tx.from : tx.to,
      };
    });

    return NextResponse.json({ bridges });
  } catch (err) {
    console.error("Bridge history error:", err);
    return NextResponse.json({ bridges: [] });
  }
}
