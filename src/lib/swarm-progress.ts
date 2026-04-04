/**
 * Shared swarm progress state — updated by the swarm engine,
 * read by the /api/swarm/progress endpoint.
 */

export interface SwarmProgress {
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

const defaultProgress: SwarmProgress = {
  phase: "",
  status: "idle",
  round: 0,
  totalRounds: 10,
  agentsDone: 0,
  totalAgents: 0,
  roundPct: 0,
  roundAvg: null,
  roundAvgs: [],
  lastLog: "",
  running: false,
  startedAt: 0,
};

// Global mutable state (shared within a single serverless invocation)
let progress: SwarmProgress = { ...defaultProgress };

export function getProgress(): SwarmProgress {
  return { ...progress };
}

export function updateProgress(update: Partial<SwarmProgress>) {
  progress = { ...progress, ...update };
}

export function resetProgress() {
  progress = { ...defaultProgress };
}
