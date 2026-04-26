/**
 * AI Consensus v2 — shared pipeline helpers used by all 3 cron steps and
 * the admin "Run Now" endpoint.
 *
 * Step 1: persona-styled web search + initial probability + bullets
 * Step 2: same personas re-assess after seeing all 20 round-1 outputs
 * Step 3: pure math — bootstrap 9999 resamples, write mean / mode / CI
 */

import crypto from "crypto";
import OpenAI from "openai";
import { eq, and, desc } from "drizzle-orm";
import {
  getDb,
  consensusRuns,
  consensusPersonaPredictions,
} from "@/db";
import { PERSONAS, type Persona } from "./personas";
import { getTopConsensusMarkets } from "@/lib/market-filters";
import { POLYMARKET_GAMMA_API } from "@/lib/constants";
import type { PolymarketEvent } from "@/types/polymarket";

// --------------------------------------------------------------------------
// Shared types
// --------------------------------------------------------------------------

export interface CandidateMarket {
  question: string;
  yesPrice: number;
  slug?: string | null;
  eventSlug?: string | null;
  clobTokenIds?: string | null;
  endDate?: string | null;
}

export interface PersonaResult {
  persona: string;
  probability: number;
  bulletPoints: string[];
  webContext?: string;
}

// Per-call timeout: web search + reasoning together typically takes 5-15s.
// 25s gives slack but caps a single hanging call so it can't sink a whole
// 60s Vercel invocation.
const openai = () =>
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 });

// --------------------------------------------------------------------------
// IDs / dates
// --------------------------------------------------------------------------

export function questionHash(q: string): string {
  return crypto
    .createHash("sha256")
    .update(q.toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

/** UTC YYYY-MM-DD — the "day" a run belongs to. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function runId(marketQuestion: string, runDate: string): string {
  return `${questionHash(marketQuestion)}-${runDate}`;
}

// --------------------------------------------------------------------------
// Per-persona web search (step 1, round 1 only)
// --------------------------------------------------------------------------

/**
 * Ask GPT (with the web_search_preview tool) to research the question
 * THROUGH the persona's lens. Returns a 3-5 bullet summary capped at 800
 * chars, or "" if the call fails. The persona's searchStyle is folded
 * into the prompt so different personas issue different search queries.
 */
async function fetchPersonaWebContext(
  persona: Persona,
  question: string,
): Promise<string> {
  try {
    const prompt = [
      `You are researching a prediction market question through the lens of: ${persona.name}.`,
      "",
      `Search instructions for your persona: ${persona.searchStyle}`,
      "",
      `Question: "${question}"`,
      "",
      "Use the web_search_preview tool to gather current information consistent with the search instructions above. Then summarize your findings as 3-5 concise bullet points of facts (with dates where possible). Do NOT give a probability or prediction yet. Pure factual digest.",
    ].join("\n");

    const response = await openai().responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    });

    const textOutput = response.output.find((o) => o.type === "message");
    if (textOutput && textOutput.type === "message") {
      const textContent = textOutput.content.find(
        (c) => c.type === "output_text",
      );
      if (textContent && textContent.type === "output_text") {
        return textContent.text.slice(0, 800);
      }
    }
    return "";
  } catch (err) {
    console.error(
      `[consensus] web search failed for persona ${persona.id}:`,
      (err as Error).message,
    );
    return "";
  }
}

// --------------------------------------------------------------------------
// JSON-extraction helper — model occasionally wraps JSON in prose / fences
// --------------------------------------------------------------------------

function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  // Try direct parse first
  try {
    return JSON.parse(trimmed) as T;
  } catch {}
  // Then try to find the first {...} block
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {}
  }
  return null;
}

// --------------------------------------------------------------------------
// Round 1 — persona search + initial vote
// --------------------------------------------------------------------------

export async function runPersonaRound1(
  persona: Persona,
  question: string,
  yesPrice: number,
): Promise<PersonaResult | null> {
  const webContext = await fetchPersonaWebContext(persona, question);
  if (!webContext) {
    // Web search hard-failed for this persona; skip them per "log and continue"
    return null;
  }

  const pct = (yesPrice * 100).toFixed(0);
  const userMsg = [
    `Market: "${question}"`,
    `Current market price: Yes ${pct}%`,
    "",
    "Web context you researched (using your persona's search style):",
    webContext,
    "",
    "Now, applying your persona's reasoning style, give your prediction.",
    "Respond with JSON only, no prose, no code fences:",
    '{"probability": <0-100 number>, "bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>"]}',
    "Provide 3-5 bullets summarizing the key findings from your research that drove your probability.",
  ].join("\n");

  try {
    const res = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 400,
      temperature: 0.8,
      messages: [
        { role: "system", content: persona.reasoningStyle },
        { role: "user", content: userMsg },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() || "";
    const parsed = extractJson<{ probability: unknown; bullets: unknown }>(raw);
    if (!parsed) return null;
    const probability = clampPct(Number(parsed.probability));
    const bullets = normalizeBullets(parsed.bullets);
    if (bullets.length === 0) return null;
    return { persona: persona.id, probability, bulletPoints: bullets, webContext };
  } catch (err) {
    console.error(
      `[consensus] round1 chat failed for persona ${persona.id}:`,
      (err as Error).message,
    );
    return null;
  }
}

// --------------------------------------------------------------------------
// Round 2 — re-assess given the full round-1 dataset (no new web search)
// --------------------------------------------------------------------------

export async function runPersonaRound2(
  persona: Persona,
  question: string,
  yesPrice: number,
  round1Snapshot: PersonaResult[],
): Promise<PersonaResult | null> {
  const pct = (yesPrice * 100).toFixed(0);
  const snapshotText = round1Snapshot
    .map(
      (r) =>
        `- ${r.persona}: ${r.probability}% — ${r.bulletPoints.slice(0, 3).join(" | ")}`,
    )
    .join("\n");

  const userMsg = [
    `Market: "${question}"`,
    `Current market price: Yes ${pct}%`,
    "",
    `In round 1, ${round1Snapshot.length} different AI personas (including you) each researched and voted independently. Their probabilities and key findings:`,
    "",
    snapshotText,
    "",
    "Apply your persona's reasoning style to RE-ASSESS your own probability in light of what the other personas found. You can hold firm or update — your call. Don't just average; weigh the new evidence on its merits.",
    "",
    "Respond with JSON only, no prose, no code fences:",
    '{"probability": <0-100 number>, "bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>"]}',
    "Provide 3-5 bullets explaining your updated reasoning.",
  ].join("\n");

  try {
    const res = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 400,
      temperature: 0.7,
      messages: [
        { role: "system", content: persona.reasoningStyle },
        { role: "user", content: userMsg },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() || "";
    const parsed = extractJson<{ probability: unknown; bullets: unknown }>(raw);
    if (!parsed) return null;
    const probability = clampPct(Number(parsed.probability));
    const bullets = normalizeBullets(parsed.bullets);
    if (bullets.length === 0) return null;
    return { persona: persona.id, probability, bulletPoints: bullets };
  } catch (err) {
    console.error(
      `[consensus] round2 chat failed for persona ${persona.id}:`,
      (err as Error).message,
    );
    return null;
  }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

function normalizeBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => (typeof b === "string" ? b.trim() : String(b)))
    .filter((b) => b.length > 0)
    .slice(0, 5);
}

// --------------------------------------------------------------------------
// Bootstrap (step 3) — pure math, no AI calls
// --------------------------------------------------------------------------

export interface BootstrapResult {
  mean: number;
  mode: number;
  p5: number;
  p95: number;
  histogram: number[]; // 40 bins from 0% to 100%
}

const HISTOGRAM_BINS = 40;
const N_RESAMPLES = 9_999;
const MODE_BIN_PCT = 0.5; // 0.5% buckets for mode detection

export function bootstrap(probabilities: number[]): BootstrapResult {
  if (probabilities.length === 0) {
    throw new Error("bootstrap: empty input");
  }
  const n = probabilities.length;
  const sampleMeans: number[] = new Array(N_RESAMPLES + 1);

  // Include the original sample as one of the 10,000
  sampleMeans[0] = probabilities.reduce((a, b) => a + b, 0) / n;

  for (let i = 0; i < N_RESAMPLES; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += probabilities[Math.floor(Math.random() * n)];
    }
    sampleMeans[i + 1] = sum / n;
  }

  sampleMeans.sort((a, b) => a - b);
  const total = sampleMeans.length;
  const mean = sampleMeans.reduce((a, b) => a + b, 0) / total;

  // Percentiles (5th and 95th — the 90% confidence interval)
  const p5 = sampleMeans[Math.floor(total * 0.05)];
  const p95 = sampleMeans[Math.floor(total * 0.95)];

  // Mode: bucket into 0.5% bins, find the most populous bin's center
  const modeBins: Record<number, number> = {};
  for (const m of sampleMeans) {
    const bin = Math.round(m / MODE_BIN_PCT) * MODE_BIN_PCT;
    modeBins[bin] = (modeBins[bin] || 0) + 1;
  }
  let mode = mean;
  let modeCount = -1;
  for (const [bin, count] of Object.entries(modeBins)) {
    if (count > modeCount) {
      modeCount = count;
      mode = Number(bin);
    }
  }

  // Histogram for UI: 40 bins of width 2.5% across [0, 100]
  const histogram = new Array(HISTOGRAM_BINS).fill(0);
  const binWidth = 100 / HISTOGRAM_BINS;
  for (const m of sampleMeans) {
    const idx = Math.min(HISTOGRAM_BINS - 1, Math.floor(m / binWidth));
    histogram[idx]++;
  }

  return { mean, mode, p5, p95, histogram };
}

// --------------------------------------------------------------------------
// DB helpers (used by all 3 cron routes)
// --------------------------------------------------------------------------

export async function insertPredictions(
  runIdValue: string,
  results: PersonaResult[],
  round: 1 | 2,
): Promise<void> {
  if (results.length === 0) return;
  const db = getDb();
  await db
    .insert(consensusPersonaPredictions)
    .values(
      results.map((r) => ({
        id: `${runIdValue}-${r.persona}-r${round}-${crypto.randomUUID().slice(0, 8)}`,
        runId: runIdValue,
        persona: r.persona,
        round,
        probability: r.probability,
        bulletPoints: JSON.stringify(r.bulletPoints),
        webContext: round === 1 ? r.webContext ?? null : null,
      })),
    )
    .onConflictDoNothing(); // (run_id, persona, round) unique idx — re-runs are no-ops
}

export async function loadRound1Snapshot(
  runIdValue: string,
): Promise<PersonaResult[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(consensusPersonaPredictions)
    .where(
      and(
        eq(consensusPersonaPredictions.runId, runIdValue),
        eq(consensusPersonaPredictions.round, 1),
      ),
    );
  return rows.map((r) => ({
    persona: r.persona,
    probability: r.probability,
    bulletPoints: safeParseArr(r.bulletPoints),
    webContext: r.webContext ?? undefined,
  }));
}

export async function loadAllPredictions(
  runIdValue: string,
): Promise<{ round: number; persona: string; probability: number }[]> {
  const db = getDb();
  const rows = await db
    .select({
      round: consensusPersonaPredictions.round,
      persona: consensusPersonaPredictions.persona,
      probability: consensusPersonaPredictions.probability,
    })
    .from(consensusPersonaPredictions)
    .where(eq(consensusPersonaPredictions.runId, runIdValue));
  return rows;
}

function safeParseArr(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Per-market step orchestration — called from cron + admin routes
// --------------------------------------------------------------------------

const MIN_SUCCESSFUL_PERSONAS = 15;

/**
 * Run step 1 for a single market: 20 parallel persona web-search + vote
 * calls, save survivors to the DB. Marks the run failed if <15 personas
 * came back with usable answers.
 */
export async function executeStep1(
  runIdValue: string,
  market: CandidateMarket,
): Promise<{ ok: boolean; succeeded: number; failed: number }> {
  const results = await Promise.all(
    PERSONAS.map((p) => runPersonaRound1(p, market.question, market.yesPrice)),
  );
  const survivors = results.filter((r): r is PersonaResult => r !== null);

  await insertPredictions(runIdValue, survivors, 1);

  const db = getDb();
  if (survivors.length < MIN_SUCCESSFUL_PERSONAS) {
    await db
      .update(consensusRuns)
      .set({
        status: "failed",
        failureReason: `step1: only ${survivors.length}/${PERSONAS.length} personas succeeded`,
        step1At: new Date(),
      })
      .where(eq(consensusRuns.id, runIdValue));
    return { ok: false, succeeded: survivors.length, failed: PERSONAS.length - survivors.length };
  }

  await db
    .update(consensusRuns)
    .set({ status: "step1_done", step1At: new Date() })
    .where(eq(consensusRuns.id, runIdValue));

  return { ok: true, succeeded: survivors.length, failed: PERSONAS.length - survivors.length };
}

/**
 * Run step 2 for a single market: load round-1 snapshot from DB, ask the
 * surviving personas to re-assess, save round-2 results.
 */
export async function executeStep2(
  runIdValue: string,
  market: CandidateMarket,
): Promise<{ ok: boolean; succeeded: number; failed: number }> {
  const snapshot = await loadRound1Snapshot(runIdValue);
  if (snapshot.length === 0) {
    return { ok: false, succeeded: 0, failed: 0 };
  }

  // Only re-poll personas that actually voted in round 1
  const personasToCall = PERSONAS.filter((p) =>
    snapshot.some((s) => s.persona === p.id),
  );

  const results = await Promise.all(
    personasToCall.map((p) =>
      runPersonaRound2(p, market.question, market.yesPrice, snapshot),
    ),
  );
  const survivors = results.filter((r): r is PersonaResult => r !== null);

  await insertPredictions(runIdValue, survivors, 2);

  const db = getDb();
  await db
    .update(consensusRuns)
    .set({ status: "step2_done", step2At: new Date() })
    .where(eq(consensusRuns.id, runIdValue));

  return { ok: true, succeeded: survivors.length, failed: personasToCall.length - survivors.length };
}

/**
 * Run step 3 for a single market: load all 40 predictions, bootstrap,
 * write mean/mode/CI/histogram to the run row.
 */
// --------------------------------------------------------------------------
// Market selection — pulled from Gamma directly (no self-fetch through our
// own API route). Mirrors the on-the-fly selection the /ai page used to do
// on the client.
// --------------------------------------------------------------------------

interface KeysetEventsResponse {
  events?: PolymarketEvent[];
  next_cursor?: string | null;
}

export async function selectCandidateMarkets(): Promise<CandidateMarket[]> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: "50",
    order: "volume",
    ascending: "false",
  });
  let events: PolymarketEvent[] = [];
  try {
    const res = await fetch(
      `${POLYMARKET_GAMMA_API}/events/keyset?${params.toString()}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (res.ok) {
      const body = (await res.json()) as KeysetEventsResponse;
      events = body.events ?? [];
    }
  } catch (err) {
    console.error("[consensus] gamma fetch failed:", (err as Error).message);
  }

  // Attach eventSlug to each market from its parent event. Without this,
  // CandidateMarket.eventSlug ends up null and the /ai page link falls
  // back to the market slug — which 404s on Polymarket because the
  // canonical URL is /event/<event-slug>, not /event/<market-slug>.
  // (Mirrors what /api/polymarket/events/route.ts does.)
  for (const event of events) {
    const slug = event.slug;
    if (!slug || !event.markets) continue;
    for (const market of event.markets) {
      (market as PolymarketEvent["markets"][number]).eventSlug = slug;
    }
  }

  const top = getTopConsensusMarkets(events);
  return top.map((m) => ({
    question: m.question,
    yesPrice: m.yesPrice,
    slug: m.slug ?? null,
    eventSlug: m.eventSlug ?? null,
    clobTokenIds: m.clobTokenIds ?? null,
    endDate: m.endDate ?? null,
  }));
}

/**
 * Look up the run row for a given (question, runDate). Returns null if no
 * row exists yet. Used by step-2 / step-3 cron handlers to find work.
 */
export async function findRunByQuestion(
  question: string,
  runDate: string,
): Promise<typeof consensusRuns.$inferSelect | null> {
  const db = getDb();
  const id = runId(question, runDate);
  const rows = await db
    .select()
    .from(consensusRuns)
    .where(eq(consensusRuns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Latest finished (step3_done) run for a market question, regardless of
 * date. Used by the /ai page so it can show the freshest snapshot.
 */
export async function findLatestRun(
  question: string,
): Promise<typeof consensusRuns.$inferSelect | null> {
  const db = getDb();
  const hash = questionHash(question);
  const rows = await db
    .select()
    .from(consensusRuns)
    .where(
      and(
        eq(consensusRuns.marketQuestionHash, hash),
        eq(consensusRuns.status, "step3_done"),
      ),
    )
    .orderBy(desc(consensusRuns.runDate))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Idempotently create a run row for (market, runDate). If `replace` is
 * true (admin "Run Now"), drops the existing row and its child predictions
 * first.
 */
export async function ensureRunRow(
  market: CandidateMarket,
  runDate: string,
  triggerSource: "cron" | "admin",
  replace: boolean,
): Promise<{ runId: string; created: boolean }> {
  const db = getDb();
  const id = runId(market.question, runDate);

  if (replace) {
    // CASCADE drops child predictions
    await db.delete(consensusRuns).where(eq(consensusRuns.id, id));
  }

  const existing = await db
    .select({ id: consensusRuns.id })
    .from(consensusRuns)
    .where(eq(consensusRuns.id, id))
    .limit(1);

  if (existing.length > 0) {
    return { runId: id, created: false };
  }

  await db.insert(consensusRuns).values({
    id,
    marketQuestion: market.question,
    marketQuestionHash: questionHash(market.question),
    marketSlug: market.slug ?? null,
    eventSlug: market.eventSlug ?? null,
    clobTokenIds: market.clobTokenIds ?? null,
    marketEndDate: market.endDate ?? null,
    runDate,
    yesPriceAtRun: market.yesPrice,
    status: "step1_pending",
    triggerSource,
  });

  return { runId: id, created: true };
}

export async function executeStep3(
  runIdValue: string,
): Promise<{ ok: boolean; mean: number; mode: number; sampleSize: number }> {
  const all = await loadAllPredictions(runIdValue);
  if (all.length === 0) {
    return { ok: false, mean: 0, mode: 0, sampleSize: 0 };
  }
  const probs = all.map((r) => r.probability);
  const stats = bootstrap(probs);

  const db = getDb();
  await db
    .update(consensusRuns)
    .set({
      status: "step3_done",
      step3At: new Date(),
      finalMean: stats.mean,
      finalMode: stats.mode,
      distributionP5: stats.p5,
      distributionP95: stats.p95,
      distributionHistogram: JSON.stringify(stats.histogram),
    })
    .where(eq(consensusRuns.id, runIdValue));

  return { ok: true, mean: stats.mean, mode: stats.mode, sampleSize: probs.length };
}
