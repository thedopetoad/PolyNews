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

/**
 * Manual AI Consensus trigger card. Sits inside /admin alongside Prize
 * Editor and Payouts Board. Replaces today's run rows for the top 10
 * markets and walks all 3 steps inline. Wall time ~30-40s on a fresh run.
 */
export function ConsensusRunNow() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = async () => {
    if (
      !confirm(
        "Run the AI Consensus pipeline now? This wipes today's existing snapshot, picks the top 10 markets, runs 20 personas through 3 rounds for each, and takes ~30-60 seconds. Spends ~$5 in OpenAI calls.",
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
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setResult((await res.json()) as RunResult);
    } catch (err) {
      setError((err as Error).message);
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

      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs text-[#f85149] bg-[#f85149]/10 border border-[#f85149]/20 px-3 py-2 rounded-md">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Run failed: {error}</span>
        </div>
      )}

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
