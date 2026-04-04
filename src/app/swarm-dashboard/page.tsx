"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Progress {
  phase: string;
  status: string;
  round: number;
  totalRounds: number;
  agentsDone: number;
  totalAgents: number;
  roundPct: number;
  roundAvg: number | null;
  roundAvgs: number[];
  lastLog: string;
  running: boolean;
  startedAt: number;
}

const PHASES = [
  { id: "knowledge", label: "Knowledge Gathering", desc: "8 web searches + GraphRAG", rounds: "—" },
  { id: "independent", label: "Independent Analysis", desc: "No social influence", rounds: "1-2" },
  { id: "social", label: "Social Feed", desc: "Follow, mute, repost, challenge", rounds: "3-5" },
  { id: "cluster", label: "Cluster Debate", desc: "Bull vs bear argument", rounds: "6-8" },
  { id: "final", label: "Final Calibration", desc: "Low temperature, high weight", rounds: "9-10" },
  { id: "aggregate", label: "Aggregation", desc: "Edge + Kelly calculation", rounds: "—" },
];

export default function SwarmDashboard() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const startRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Poll progress
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/swarm/progress");
        if (!res.ok) return;
        const data: Progress = await res.json();
        setProgress(data);
        if (data.lastLog && !logs.includes(data.lastLog)) {
          setLogs((prev) => [...prev, data.lastLog]);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [running, logs]);

  // Elapsed timer
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000);
      setElapsed(`${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const startSwarm = async () => {
    setRunning(true);
    setResult(null);
    setLogs(["Starting Super Swarm..."]);
    startRef.current = Date.now();

    try {
      const res = await fetch("/api/swarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketQuestion: "S&P 500 Opens Up or Down on April 6?",
          marketPrice: 0.50,
          marketId: "sp500-opens-up-down-april-6",
          agentCount: 500,
        }),
      });

      if (!res.ok) {
        setLogs((prev) => [...prev, `ERROR: ${res.status}`]);
        setRunning(false);
        return;
      }

      const data = await res.json();
      setResult(data);
      setLogs((prev) => [...prev, "Swarm complete! Results saved to database."]);
    } catch (err) {
      setLogs((prev) => [...prev, `FATAL: ${err instanceof Error ? err.message : "unknown"}`]);
    }
    setRunning(false);
  };

  const currentPhaseIdx = progress ? PHASES.findIndex((p) => p.id === progress.phase) : -1;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-black bg-[#d29922] px-2 py-0.5 rounded">LIVE</span>
          <h1 className="text-2xl font-bold">Super Swarm Dashboard</h1>
        </div>
        <p className="text-sm text-[#768390] mb-6">S&P 500 Opens Up or Down — April 6 | 500 agents x 10 rounds</p>

        {/* Start button */}
        {!running && !result && (
          <div className="mb-6">
            <button onClick={startSwarm} className="px-6 py-3 rounded-lg bg-[#d29922] text-black font-semibold text-sm hover:bg-[#b8860b]">
              Run Super Swarm
            </button>
            <p className="text-[11px] text-[#484f58] mt-2">~30-45 minutes | ~$15-25 OpenAI credits</p>
          </div>
        )}

        {/* Dashboard */}
        {(running || result) && (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
                <p className="text-[10px] text-[#484f58] uppercase">Elapsed</p>
                <p className="text-2xl font-bold text-[#58a6ff] tabular-nums">{elapsed}</p>
              </div>
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
                <p className="text-[10px] text-[#484f58] uppercase">Round</p>
                <p className="text-2xl font-bold tabular-nums">{progress?.round || 0}/{progress?.totalRounds || 10}</p>
              </div>
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
                <p className="text-[10px] text-[#484f58] uppercase">Agents This Round</p>
                <p className="text-2xl font-bold tabular-nums">{(progress?.agentsDone || 0).toLocaleString()}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <p className="text-sm text-[#d29922] mb-2">{progress?.status || "Initializing..."}</p>
              <div className="bg-[#21262d] rounded-full h-5 overflow-hidden relative">
                <div className="bg-[#d29922] h-full rounded-full transition-all duration-300" style={{ width: `${progress?.roundPct || 0}%` }} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{progress?.roundPct || 0}%</span>
              </div>
            </div>

            {/* Phases */}
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <p className="text-[10px] text-[#484f58] uppercase mb-3">Phases</p>
              {PHASES.map((phase, idx) => {
                const isDone = idx < currentPhaseIdx;
                const isCurrent = idx === currentPhaseIdx;
                return (
                  <div key={phase.id} className="flex items-center gap-3 py-1.5">
                    <span className={cn("text-sm w-5 text-center", isDone ? "text-[#3fb950]" : isCurrent ? "text-[#d29922]" : "text-[#484f58]")}>
                      {isDone ? "✓" : isCurrent ? "▶" : "○"}
                    </span>
                    <span className={cn("text-sm flex-1", isCurrent ? "text-white font-semibold" : isDone ? "text-[#3fb950]" : "text-[#484f58]")}>
                      {phase.label}
                    </span>
                    <span className="text-[10px] text-[#484f58]">{phase.desc}</span>
                    <span className="text-[10px] text-[#484f58] w-8 text-right">R{phase.rounds}</span>
                  </div>
                );
              })}
            </div>

            {/* Trajectory */}
            {progress?.roundAvgs && progress.roundAvgs.length > 0 && (
              <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
                <p className="text-[10px] text-[#484f58] uppercase mb-3">Consensus Trajectory</p>
                <div className="flex items-end gap-1 h-24">
                  {progress.roundAvgs.map((avg, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-[#768390] tabular-nums">{avg}%</span>
                      <div
                        className={cn("w-full rounded-t", idx >= 8 ? "bg-[#58a6ff]" : idx >= 5 ? "bg-[#58a6ff]/70" : idx >= 2 ? "bg-[#58a6ff]/50" : "bg-[#58a6ff]/30")}
                        style={{ height: `${Math.max(8, avg)}%` }}
                      />
                      <span className="text-[8px] text-[#484f58]">R{idx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Log */}
            <div className="rounded-lg border border-[#21262d] bg-[#161b22] p-4">
              <p className="text-[10px] text-[#484f58] uppercase mb-2">Live Log</p>
              <div ref={logRef} className="bg-[#0d1117] rounded border border-[#21262d] p-3 max-h-48 overflow-y-auto font-mono text-[11px] text-[#768390] space-y-1">
                {logs.map((log, i) => (
                  <div key={i}>[{new Date().toLocaleTimeString()}] {log}</div>
                ))}
              </div>
            </div>

            {/* Results */}
            {result && (
              <div className="rounded-lg border border-[#3fb950]/30 bg-[#161b22] p-6">
                <p className="text-lg font-bold text-[#3fb950] mb-4">Swarm Complete!</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] text-[#484f58] uppercase">Consensus</p>
                    <p className="text-3xl font-bold text-[#58a6ff] tabular-nums">{(result.consensus as number)?.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#484f58] uppercase">Edge</p>
                    <p className={cn("text-3xl font-bold tabular-nums", (result.edge as number) > 3 ? "text-[#3fb950]" : (result.edge as number) < -3 ? "text-[#f85149]" : "text-[#768390]")}>
                      {(result.edge as number) > 0 ? "+" : ""}{(result.edge as number)?.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#484f58] uppercase">Signal</p>
                    <p className={cn("text-2xl font-bold", (result.recommendation as string)?.includes("BUY") ? "text-[#d29922]" : "text-[#484f58]")}>
                      {result.recommendation as string}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-[#484f58] mt-4">
                  {(result.agentCount as number)?.toLocaleString()} agents | {result.rounds as number} rounds | Kelly: {(result.kellyScore as number)?.toFixed(3)} | Saved to database
                </p>
                <p className="text-[11px] text-[#58a6ff] mt-1">Check polystream.vercel.app/ai-beta to see results live</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
