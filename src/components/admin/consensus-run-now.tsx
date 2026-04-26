"use client";

import { useState } from "react";
import { Brain, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

interface RunResult {
  runDate: string;
  candidates: number;
  step1: { ok: number; failed: number };
  step2: { results: Array<{ ok: boolean; succeeded: number; failed: number }> };
  step3: {
    results: Array<{
      ok: boolean;
      mean: number;
      mode: number;
      sampleSize: number;
      question: string;
    }>;
  };
  durationMs: number;
}

type ErrorCode =
  | "schema_missing"
  | "openai_missing"
  | "openai_quota"
  | "db_unreachable"
  | "no_markets"
  | "unknown";

interface RunError {
  code: ErrorCode;
  detail: string;
  status: number;
}

/** Per-error-code title + remediation steps shown to the admin. */
const ERROR_GUIDE: Record<ErrorCode, { title: string; remediation: string[] }> = {
  schema_missing: {
    title: "Consensus tables don't exist yet",
    remediation: [
      "Run `npx drizzle-kit push` locally to create consensus_runs + consensus_persona_predictions",
      "Or check that DATABASE_URL on Vercel points at the Neon DB you ran the migration against",
    ],
  },
  openai_missing: {
    title: "OPENAI_API_KEY is not set",
    remediation: [
      "Vercel → polystream → Settings → Environment Variables → add OPENAI_API_KEY (Production)",
      "Then trigger a redeploy so the env var is picked up",
    ],
  },
  openai_quota: {
    title: "OpenAI rate-limited or out of quota",
    remediation: [
      "Check OpenAI dashboard usage / spending limits",
      "Wait a minute and retry, or upgrade the OpenAI tier if this keeps happening",
    ],
  },
  db_unreachable: {
    title: "Couldn't connect to the database",
    remediation: [
      "Check that DATABASE_URL is set in Vercel env vars",
      "Verify the Neon project hasn't been paused or deleted",
    ],
  },
  no_markets: {
    title: "Polymarket returned no qualifying markets",
    remediation: [
      "Likely a temporary Gamma API blip — try again in a minute",
      "If this persists, check that the top-10 filter rules in market-filters.ts aren't too aggressive",
    ],
  },
  unknown: {
    title: "Run failed",
    remediation: ["Check Vercel function logs for /api/admin/consensus-run-now"],
  },
};

/**
 * Manual AI Consensus trigger card. Sits inside /admin alongside Prize
 * Editor and Payouts Board. Replaces today's run rows for the top 10
 * markets and walks all 3 steps inline. Wall time ~30-40s on a fresh run.
 */
export function ConsensusRunNow() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);

  const trigger = async () => {
    if (
      !confirm(
        "Run the AI Consensus pipeline now? This wipes today's existing snapshot, picks the top 10 markets, runs 20 personas through 2 rounds for each, and takes ~30-60 seconds. Spends ~$5 in OpenAI calls.",
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/consensus-run-now", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        const code = (body.error && body.error in ERROR_GUIDE ? body.error : "unknown") as ErrorCode;
        setError({
          code,
          detail: body.detail ?? body.error ?? `HTTP ${res.status}`,
          status: res.status,
        });
        return;
      }
      setResult((await res.json()) as RunResult);
    } catch (err) {
      setError({ code: "unknown", detail: (err as Error).message, status: 0 });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#a371f7]" />
            AI Consensus
          </h2>
          <p className="text-[11px] text-[#768390] mt-1 max-w-xl">
            Daily cron runs at 06:00 / 06:15 / 06:30 UTC (production only).
            Click to trigger now — wipes today&rsquo;s snapshot and re-runs
            the full 3-step pipeline for the top 10 markets.
          </p>
        </div>
        <button
          onClick={trigger}
          disabled={running}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-[#a371f7]/10 text-[#a371f7] border border-[#a371f7]/30 hover:bg-[#a371f7]/20 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {running ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Running (~30-60s)…
            </>
          ) : (
            <>
              <Brain className="w-4 h-4" />
              Run Now
            </>
          )}
        </button>
      </div>

      {error && (() => {
        const guide = ERROR_GUIDE[error.code];
        return (
          <div className="mt-3 bg-[#f85149]/5 border border-[#f85149]/30 rounded-md p-3">
            <div className="flex items-start gap-2 text-xs text-[#f85149]">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">{guide.title}</p>
                <p className="text-[#f85149]/80 mt-0.5 font-mono text-[10px] break-all">
                  {error.code} {error.status > 0 ? `· HTTP ${error.status}` : ""} · {error.detail}
                </p>
              </div>
            </div>
            <div className="mt-2 pl-5">
              <p className="text-[10px] text-[#768390] uppercase tracking-wider mb-1">How to fix</p>
              <ul className="text-[11px] text-[#adbac7] space-y-0.5 list-disc list-inside">
                {guide.remediation.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      })()}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#3fb950] bg-[#3fb950]/10 border border-[#3fb950]/20 px-3 py-2 rounded-md">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              Snapshot complete in {(result.durationMs / 1000).toFixed(1)}s.{" "}
              {result.step1.ok}/{result.candidates} markets succeeded step 1.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {result.step3.results.map((r, i) => (
              <div
                key={i}
                className="bg-[#0d1117] border border-[#21262d] rounded-md p-2.5 text-[11px]"
              >
                <p className="text-[#e6edf3] font-medium truncate">{r.question}</p>
                <div className="flex items-center justify-between mt-1 text-[#768390]">
                  <span>
                    mean {(r.mean ?? 0).toFixed(1)}% / mode {(r.mode ?? 0).toFixed(1)}%
                  </span>
                  <span className="text-[#484f58]">
                    {r.sampleSize} votes
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
