import OpenAI from "openai";
import { calibrateSwarmPrediction } from "./calibration";
import { getDb, swarmAgentMemory } from "@/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { updateProgress, resetProgress } from "./swarm-progress";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── Types ───

interface AgentPrediction {
  probability: number;
  confidence: number;
  reasoning: string;
}

interface AgentProfile {
  archetype: string;
  temperature: number;
  prompt: string;
}

interface ClusterInfo {
  size: number;
  avgPrediction: number;
  topArgument: string;
}

export interface SwarmResult {
  consensus: number;
  marketPrice: number;
  edge: number;
  edgeDirection: "undervalued" | "overvalued" | "neutral";
  confidence: number;
  kellyScore: number;
  recommendation: string;
  agentCount: number;
  rounds: number;
  clusterAnalysis: {
    bullCluster: ClusterInfo;
    bearCluster: ClusterInfo;
    undecided: ClusterInfo;
  };
  roundProgression: number[];
  consensusStability: number;
  calibratedConsensus: number;
  calibrationAdjustment: number;
  historicalBias: string;
  webContext: string;
  agentLogs: { archetype: string; round: number; probability: number; confidence: number; reasoning: string }[];
}

// ─── 20 Archetypes ───

const ARCHETYPES = [
  { name: "Political Analyst", prompt: "You are a nonpartisan political analyst. Focus on polling data, electoral math, and historical voting patterns." },
  { name: "Conservative Strategist", prompt: "You are a Republican political strategist. Focus on party dynamics, base enthusiasm, and endorsement signals." },
  { name: "Legal Scholar", prompt: "You are a constitutional law professor. Focus on legal proceedings, indictments, and how legal trouble affects electability." },
  { name: "Pollster", prompt: "You are a professional pollster. Focus on survey methodology, likely voter screens, and margin of error." },
  { name: "Campaign Finance Analyst", prompt: "You are a campaign finance expert. Focus on fundraising, donor networks, PAC spending, and ad buys." },
  { name: "Texas Political Insider", prompt: "You are a Texas political operative who has worked on statewide races. Focus on ground game, county-level dynamics, and local endorsements." },
  { name: "Republican Voter (Moderate)", prompt: "You are a moderate suburban Republican voter in Texas. Think about what matters to you and your neighbors." },
  { name: "Republican Voter (MAGA)", prompt: "You are a Trump-supporting Republican primary voter in rural Texas. Focus on loyalty, fighting the establishment, and culture war issues." },
  { name: "Independent Analyst", prompt: "You are a nonpartisan forecaster who uses base rates and reference classes. Focus on incumbency advantage, primary dynamics, and reversion to mean." },
  { name: "Contrarian", prompt: "You MUST argue against the consensus. Find the strongest case for the less popular outcome. Challenge every assumption." },
  { name: "Data Scientist", prompt: "You are a quantitative analyst. Focus on statistical models, prediction market efficiency, and Bayesian updating." },
  { name: "Political Historian", prompt: "You are a political historian specializing in Texas politics. Focus on precedents, historical primary results, and long-term trends." },
  { name: "Media Analyst", prompt: "You are a media analyst. Focus on media coverage, narrative framing, name recognition, and social media momentum." },
  { name: "Demographic Expert", prompt: "You are a demographer. Focus on population shifts, voter registration trends, and demographic composition of the Republican primary electorate." },
  { name: "Fundraising Analyst", prompt: "You are a political fundraising consultant. Focus on small-dollar donors vs PAC money, burn rates, and cash-on-hand." },
  { name: "Grassroots Organizer", prompt: "You are a grassroots political organizer in Texas. Focus on volunteer networks, door-knocking data, and rally attendance." },
  { name: "Lobbyist", prompt: "You are a Texas lobbyist. Focus on which interest groups are backing which candidate and what policy promises have been made." },
  { name: "Former Officeholder", prompt: "You are a former Texas state legislator. Focus on institutional support, party machinery, and the practical mechanics of winning a primary." },
  { name: "Betting Market Analyst", prompt: "You are a prediction market analyst. Focus on market efficiency, line movement, sharp money vs public money, and contrarian indicators." },
  { name: "Devil's Advocate", prompt: "You are a devil's advocate. Whatever the majority thinks, argue the opposite with the strongest possible reasoning. Find blind spots." },
];

// ─── Phase 1: Deep Knowledge Gathering ───

function getSearchQueries(question: string): string[] {
  const q = question.toLowerCase();
  const isFinancial = q.includes("s&p") || q.includes("oil") || q.includes("wti") || q.includes("nasdaq") || q.includes("dow") || q.includes("stock") || q.includes("crude") || q.includes("gold") || q.includes("bitcoin price") || q.includes("opens up or down");
  const isGeopolitical = q.includes("war") || q.includes("forces") || q.includes("iran") || q.includes("invade") || q.includes("military") || q.includes("sanctions");

  if (isFinancial) {
    return [
      // Current state
      `${question} current price level today, last close, after hours movement`,
      `${question} latest trading session recap: what happened, key levels, volume`,
      // Technical
      `${question} technical analysis chart: 50 day moving average, 200 day moving average, RSI, MACD, Bollinger bands`,
      `${question} key support and resistance levels, pivot points, Fibonacci retracement`,
      // Futures & pre-market
      `${question} futures right now, pre-market data, overnight session, Asian and European session`,
      `S&P 500 futures ES contract current level and direction today`,
      // Macro
      `Federal Reserve latest statement, interest rate decision, dot plot, quantitative tightening 2026`,
      `latest CPI PPI inflation data, jobs report NFP, unemployment rate, GDP growth 2026`,
      `US Treasury yields 10 year 2 year spread, yield curve inversion status today`,
      // Geopolitical
      `Trump tariffs trade war latest news impact on stock market April 2026`,
      `major geopolitical risks affecting markets today: wars, sanctions, oil supply`,
      // Sentiment
      `VIX volatility index current level, fear and greed index, put call ratio today`,
      `Wall Street analyst consensus, Goldman Sachs JP Morgan market outlook this week`,
      // Historical
      `S&P 500 historical pattern: what happens on Mondays, day of week effect, seasonal patterns April`,
      `stock market performance after tariff announcements historically`,
    ];
  }

  if (isGeopolitical) {
    return [
      // Breaking news
      `${question} latest breaking news today`,
      `${question} latest developments past 48 hours`,
      // Military
      `US military deployments Middle East, aircraft carriers, troop movements near Iran 2026`,
      `Iran military capabilities, nuclear program status, IRGC activities 2026`,
      // Diplomatic
      `US Iran diplomatic channels, negotiations, back channel communications 2026`,
      `UN Security Council resolutions sanctions Iran latest`,
      `allied nations positions on ${question}: UK, France, Israel, Saudi Arabia`,
      // Intelligence
      `intelligence assessments threat level Iran conflict probability 2026`,
      `think tank analysis RAND Brookings CSIS on US Iran conflict probability`,
      // Economic
      `oil price impact if US strikes Iran, Strait of Hormuz shipping risk`,
      `defense stocks military industrial complex stocks movement related to Iran tensions`,
      // Historical
      `historical US military operations Middle East: Iraq, Syria, Libya — what preceded them`,
      `US Iran near-miss conflicts: 2020 Soleimani, tanker wars — how close to war`,
      // Prediction markets
      `prediction market odds US Iran conflict, Polymarket Metaculus forecasts`,
    ];
  }

  // Default: political/general
  return [
    `${question} latest news and developments today`,
    `${question} latest polls, surveys, prediction market odds`,
    `${question} key players, endorsements, institutional positions`,
    `${question} controversies, legal issues, potential disqualifiers`,
    `${question} fundraising data, campaign finance, spending`,
    `${question} demographic analysis, voter turnout expectations`,
    `${question} expert analysis, political scientist assessments`,
    `${question} historical precedents, base rates for similar situations`,
    `${question} social media sentiment, public opinion trends`,
    `${question} upcoming catalysts, scheduled events, deadlines`,
  ];
}

async function gatherKnowledge(question: string): Promise<string> {
  const searches = getSearchQueries(question);

  const results = await Promise.all(
    searches.map(async (query) => {
      try {
        const response = await getOpenAI().responses.create({
          model: "gpt-4o-mini",
          tools: [{ type: "web_search_preview" }],
          input: `Search the web thoroughly and provide a detailed factual summary (8-12 bullet points) of the most relevant recent information for: "${query}"\n\nFocus on HARD DATA only — exact prices, percentages, dollar amounts, dates, specific numbers, named sources. No vague opinions. Include exact timestamps and sources where possible. Be thorough — more data is better.`,
        });
        const textOutput = response.output.find((o) => o.type === "message");
        if (textOutput && textOutput.type === "message") {
          const textContent = textOutput.content.find((c) => c.type === "output_text");
          if (textContent && textContent.type === "output_text") {
            return textContent.text.slice(0, 1200);
          }
        }
        return "";
      } catch {
        return "";
      }
    })
  );

  const combined = results.filter(Boolean).join("\n\n---\n\n");
  if (!combined) return "";

  // Phase 1b: Build GraphRAG knowledge graph from raw search results
  // Extract entities and relationships for structured reasoning
  try {
    const graphResponse = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are a knowledge graph builder for prediction markets. Extract entities and relationships from the research below. Output a structured brief:

1. KEY ENTITIES: Main actors, instruments, events (with current values/levels if financial)
2. RELATIONSHIPS: entity→relationship→entity triples (e.g., "Fed→raised→rates", "S&P→testing→support at 5200")
3. CRITICAL DATA POINTS: The 8 most important numbers (exact prices, dates, percentages, levels)
4. BULL FACTORS: 4 strongest reasons for YES/UP outcome, with supporting data
5. BEAR FACTORS: 4 strongest reasons for NO/DOWN outcome, with supporting data
6. BASE RATE: What historically happens in similar conditions? Include specific percentages.
7. CATALYSTS: Upcoming events that could move this market (with dates)

Be data-dense. Every claim should have a number attached.`,
        },
        {
          role: "user",
          content: `Build a comprehensive knowledge graph for the prediction market: "${question}"\n\nRaw research:\n${combined.slice(0, 6000)}`,
        },
      ],
    });

    const graph = graphResponse.choices[0]?.message?.content || "";
    return `KNOWLEDGE GRAPH:\n${graph}\n\nRAW RESEARCH:\n${combined.slice(0, 5000)}`;
  } catch {
    return combined.slice(0, 8000);
  }
}

// ─── Agent Memory System ───

/**
 * Fetch past predictions for an archetype to build memory context.
 * Agents learn from their track record — if they've been consistently
 * wrong in one direction, the memory tells them to adjust.
 */
async function getAgentMemory(archetype: string): Promise<string> {
  try {
    const db = getDb();
    const memories = await db
      .select()
      .from(swarmAgentMemory)
      .where(
        and(
          eq(swarmAgentMemory.agentArchetype, archetype),
          isNotNull(swarmAgentMemory.actualOutcome)
        )
      )
      .orderBy(desc(swarmAgentMemory.createdAt))
      .limit(5);

    if (memories.length === 0) return "";

    const correct = memories.filter((m) => m.wasCorrect).length;
    const total = memories.length;
    const avgError = memories.reduce((s, m) => {
      return s + ((m.prediction || 50) - (m.actualOutcome || 50));
    }, 0) / total;

    let memoryContext = `\nYOUR TRACK RECORD (${total} past predictions, ${correct} correct):`;
    if (avgError > 5) memoryContext += `\nWARNING: You tend to OVERESTIMATE by ~${Math.round(avgError)}%. Adjust down.`;
    else if (avgError < -5) memoryContext += `\nWARNING: You tend to UNDERESTIMATE by ~${Math.round(Math.abs(avgError))}%. Adjust up.`;
    else memoryContext += `\nYour predictions have been well-calibrated (avg error: ${Math.round(avgError)}%).`;

    memories.slice(0, 3).forEach((m) => {
      memoryContext += `\n- Predicted ${m.prediction?.toFixed(0)}%, actual was ${m.actualOutcome?.toFixed(0)}% (${m.wasCorrect ? "CORRECT" : "WRONG"})`;
    });

    return memoryContext;
  } catch {
    return "";
  }
}

/**
 * Save agent predictions to memory for future learning.
 */
async function saveAgentMemory(
  predictions: { archetype: string; probability: number; reasoning: string }[],
  marketId: string,
): Promise<void> {
  try {
    const db = getDb();
    const crypto = await import("crypto");
    // Save one memory per archetype (use the archetype's final-round prediction)
    const seen = new Set<string>();
    for (const pred of predictions) {
      if (seen.has(pred.archetype)) continue;
      seen.add(pred.archetype);
      await db.insert(swarmAgentMemory).values({
        id: crypto.randomUUID(),
        agentArchetype: pred.archetype,
        marketId,
        prediction: pred.probability,
        reasoning: pred.reasoning?.slice(0, 300) || "",
      });
    }
  } catch {}
}

// ─── Phase 2: Generate Agent Profiles ───

function generateAgents(count: number): AgentProfile[] {
  const agents: AgentProfile[] = [];
  const perArchetype = Math.ceil(count / ARCHETYPES.length);

  for (const archetype of ARCHETYPES) {
    for (let i = 0; i < perArchetype && agents.length < count; i++) {
      // Temperature varies: 0.4 to 1.2 across personality variations
      const temp = 0.4 + (i / perArchetype) * 0.8;
      // Personality modifier
      const modifiers = ["Be analytical and cautious.", "Be bold and decisive.", "Focus on overlooked factors.", "Weigh evidence carefully.", "Think probabilistically.", "Consider tail risks.", "Focus on the most likely scenario.", "Consider momentum and trends.", "Be skeptical of conventional wisdom.", "Trust the data above narratives."];
      const modifier = modifiers[i % modifiers.length];

      agents.push({
        archetype: archetype.name,
        temperature: Math.round(temp * 100) / 100,
        prompt: `${archetype.prompt} ${modifier}`,
      });
    }
  }

  return agents;
}

// ─── Call a single agent with retry ───

async function callAgent(systemPrompt: string, userMsg: string, temp: number, retries: number = 3): Promise<AgentPrediction | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 150,
        temperature: temp,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() || "{}";
    // Extract JSON even if wrapped in markdown
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      probability: Math.max(0, Math.min(100, Number(parsed.probability) || 50)),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      reasoning: String(parsed.reasoning || "").slice(0, 200),
    };
  } catch {
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
      continue;
    }
    return null;
  }
  }
  return null;
}

// ─── Progress callback type ───
export type SwarmProgressCallback = (phase: string, round: number, totalRounds: number, agentsComplete: number, totalAgents: number) => void;

// ─── Run agents in batches with throttling + retries ───

async function runAgentBatch(
  agents: AgentProfile[],
  userMsg: string,
  batchSize: number = 25,
  onProgress?: (done: number, total: number) => void,
): Promise<(AgentPrediction & { archetype: string })[]> {
  const results: (AgentPrediction & { archetype: string })[] = [];

  for (let i = 0; i < agents.length; i += batchSize) {
    const batch = agents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (agent) => {
        const pred = await callAgent(agent.prompt, userMsg, agent.temperature);
        return pred ? { ...pred, archetype: agent.archetype } : null;
      })
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (onProgress) onProgress(Math.min(i + batchSize, agents.length), agents.length);
    // Throttle: 500ms between batches to avoid rate limits
    if (i + batchSize < agents.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

// ─── Identify clusters ───

function analyzeClusters(predictions: AgentPrediction[]): { bullCluster: ClusterInfo; bearCluster: ClusterInfo; undecided: ClusterInfo } {
  const bull = predictions.filter((p) => p.probability >= 60);
  const bear = predictions.filter((p) => p.probability <= 40);
  const mid = predictions.filter((p) => p.probability > 40 && p.probability < 60);

  const topArg = (arr: AgentPrediction[]) =>
    arr.sort((a, b) => b.confidence - a.confidence)[0]?.reasoning || "No argument";
  const avg = (arr: AgentPrediction[]) =>
    arr.length > 0 ? arr.reduce((s, p) => s + p.probability, 0) / arr.length : 50;

  return {
    bullCluster: { size: bull.length, avgPrediction: Math.round(avg(bull)), topArgument: topArg(bull) },
    bearCluster: { size: bear.length, avgPrediction: Math.round(avg(bear)), topArgument: topArg(bear) },
    undecided: { size: mid.length, avgPrediction: Math.round(avg(mid)), topArgument: topArg(mid) },
  };
}

// ─── Phase 3 & 4: Social Simulation + Aggregation ───

export async function runSwarmPrediction(
  question: string,
  marketPrice: number,
  agentCount: number = 500,
  onProgress?: SwarmProgressCallback,
): Promise<SwarmResult> {
  const pct = (marketPrice * 100).toFixed(0);

  // Phase 1: Deep knowledge gathering
  resetProgress();
  updateProgress({ running: true, startedAt: Date.now(), totalAgents: agentCount, totalRounds: 10 });
  updateProgress({ phase: "knowledge", status: "Searching the web (8 searches + GraphRAG)...", lastLog: "Phase 1: Knowledge gathering started" });
  console.log("[Swarm] Phase 1: Gathering knowledge...");
  const webContext = await gatherKnowledge(question);

  // Phase 2: Generate agents + load memory
  updateProgress({ phase: "knowledge", status: "Knowledge graph built. Generating agents...", lastLog: "Phase 1 complete. GraphRAG built." });
  console.log(`[Swarm] Phase 2: Generating ${agentCount} agents + loading memory...`);
  const agents = generateAgents(agentCount);

  // Load persistent memory for each archetype (parallel)
  const uniqueArchetypes = [...new Set(agents.map((a) => a.archetype))];
  const memoryMap = new Map<string, string>();
  await Promise.all(
    uniqueArchetypes.map(async (arch) => {
      const memory = await getAgentMemory(arch);
      if (memory) memoryMap.set(arch, memory);
    })
  );

  // Inject memory into agent system prompts
  for (const agent of agents) {
    const memory = memoryMap.get(agent.archetype);
    if (memory) {
      agent.prompt += memory;
    }
  }

  const baseQ = `Market: "${question}"\nCurrent Polymarket Price: Yes ${pct}%\n\nLIVE RESEARCH CONTEXT:\n${webContext}\n\nPredict the TRUE probability of YES (0-100), your confidence (0-100), and reasoning. JSON only:\n{"probability":<0-100>,"confidence":<0-100>,"reasoning":"<1-2 sentences>"}`;

  const allLogs: SwarmResult["agentLogs"] = [];
  const roundAvgs: number[] = [];

  // Track per-agent predictions across rounds for consistency scoring
  const agentHistory: Map<string, number[]> = new Map();

  // ─── Rounds 1-2: Independent Analysis ───
  updateProgress({ phase: "independent", status: "Round 1: Independent analysis...", round: 1, agentsDone: 0, lastLog: `${agentCount} agents generated. Starting Round 1.` });
  console.log("[Swarm] Rounds 1-2: Independent analysis...");
  const makeProgress = (phase: string, round: number) => (done: number, total: number) => {
    if (onProgress) onProgress(phase, round, 10, done, total);
    updateProgress({ round, agentsDone: done, roundPct: Math.round((done / total) * 100), status: `Round ${round}: ${done}/${total} agents (${Math.round((done / total) * 100)}%)` });
  };

  const r1 = await runAgentBatch(agents, baseQ, 50, makeProgress("Independent Analysis", 1));
  const r1Avg = r1.reduce((s, p) => s + p.probability, 0) / (r1.length || 1);
  roundAvgs.push(Math.round(r1Avg));
  updateProgress({ roundAvg: Math.round(r1Avg), roundAvgs: [...roundAvgs], lastLog: `R1 done: ${r1.length} agents responded, avg ${Math.round(r1Avg)}%` });
  r1.forEach((p, i) => {
    allLogs.push({ archetype: p.archetype, round: 1, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
    const key = `${p.archetype}-${i % 10}`;
    agentHistory.set(key, [p.probability]);
  });

  const r2 = await runAgentBatch(agents, baseQ, 50, makeProgress("Independent Analysis", 2));
  const r2Avg = r2.reduce((s, p) => s + p.probability, 0) / (r2.length || 1);
  roundAvgs.push(Math.round(r2Avg));
  updateProgress({ phase: "social", roundAvg: Math.round(r2Avg), roundAvgs: [...roundAvgs], lastLog: `R2 done: ${r2.length} agents, avg ${Math.round(r2Avg)}%. Starting social simulation.` });
  r2.forEach((p, i) => {
    allLogs.push({ archetype: p.archetype, round: 2, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
    const key = `${p.archetype}-${i % 10}`;
    agentHistory.get(key)?.push(p.probability);
  });

  // ─── Rounds 3-5: Social Feed (follow, repost, argue) ───
  console.log("[Swarm] Rounds 3-5: Social feed simulation...");
  const allR12 = [...r1, ...r2];
  const stdDev = Math.sqrt(allR12.reduce((s, p) => s + (p.probability - r2Avg) ** 2, 0) / (allR12.length || 1));

  // Social behaviors: agents "follow" similar thinkers, "repost" compelling arguments
  // Simulate by showing each agent a curated feed based on proximity to their own prediction
  for (let round = 3; round <= 5; round++) {
    // Build social feed: mix of popular posts, contrarian posts, and nearby-opinion posts
    const sorted = [...allR12].sort((a, b) => b.confidence - a.confidence);
    const topPosts = sorted.slice(0, 5).map((p) => `[${p.archetype}] (${p.probability}%, conf ${p.confidence}): "${p.reasoning}"`);
    const contrarian = sorted.filter((p) => Math.abs(p.probability - roundAvgs[roundAvgs.length - 1]) > 20).slice(0, 3);
    const contrarianPosts = contrarian.map((p) => `[CONTRARIAN ${p.archetype}] (${p.probability}%): "${p.reasoning}"`);

    // Agents who shifted most between r1→r2 get highlighted (social signal)
    const shifters = allR12.filter((_, i) => i < r1.length).map((p, i) => {
      const r2p = r2[i];
      return r2p ? { archetype: p.archetype, shift: r2p.probability - p.probability, reasoning: r2p.reasoning } : null;
    }).filter(Boolean).sort((a, b) => Math.abs(b!.shift) - Math.abs(a!.shift)).slice(0, 3);
    const shiftPosts = shifters.map((s) => `[OPINION SHIFT ${s!.archetype}] changed by ${s!.shift > 0 ? "+" : ""}${s!.shift.toFixed(0)}%: "${s!.reasoning}"`);

    const socialFeed = [
      `TRENDING POSTS (most confident):`, ...topPosts,
      `\nCONTRARIAN VOICES:`, ...contrarianPosts,
      `\nOPINION SHIFTS (agents who changed their mind):`, ...shiftPosts,
    ].join("\n");

    const socialQ = `${baseQ}\n\nSOCIAL FEED (Round ${round}):\nConsensus: ${roundAvgs[roundAvgs.length - 1]}% (std dev: ${stdDev.toFixed(0)}%)\n\n${socialFeed}\n\nYou've read these posts on the prediction forum. You can FOLLOW compelling arguments, MUTE bad reasoning, or CHALLENGE takes you disagree with. Update your prediction.`;

    const rN = await runAgentBatch(agents, socialQ, 50, makeProgress("Social Feed", round));
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    updateProgress({ roundAvg: Math.round(rNAvg), roundAvgs: [...roundAvgs], lastLog: `R${round} done: ${rN.length} agents, avg ${Math.round(rNAvg)}%`, phase: round >= 5 ? "cluster" : "social" });
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });

    allR12.push(...rN);
  }

  // ─── Rounds 6-8: Cluster Formation + Debate ───
  console.log("[Swarm] Rounds 6-8: Cluster debate...");
  const latestPredictions = allLogs.filter((l) => l.round === 5);
  const clusters = analyzeClusters(latestPredictions.map((l) => ({ probability: l.probability, confidence: l.confidence, reasoning: l.reasoning })));

  // Build debate threads: bull vs bear cluster leaders argue
  const bullLeader = latestPredictions.sort((a, b) => b.probability - a.probability)[0];
  const bearLeader = latestPredictions.sort((a, b) => a.probability - b.probability)[0];

  for (let round = 6; round <= 8; round++) {
    const debateQ = `${baseQ}\n\nCLUSTER DEBATE (Round ${round}):\n\nBULL CLUSTER (${clusters.bullCluster.size} agents, avg ${clusters.bullCluster.avgPrediction}%):\nLeader [${bullLeader?.archetype}]: "${clusters.bullCluster.topArgument}"\n${clusters.bullCluster.size} agents REPOSTED this argument.\n\nBEAR CLUSTER (${clusters.bearCluster.size} agents, avg ${clusters.bearCluster.avgPrediction}%):\nLeader [${bearLeader?.archetype}]: "${clusters.bearCluster.topArgument}"\n${clusters.bearCluster.size} agents REPOSTED this argument.\n\nUNDECIDED: ${clusters.undecided.size} agents MUTED both sides.\n\nThe debate is heating up. Which side has the stronger evidence? You can FOLLOW one cluster's reasoning or stake out your own position.`;

    const rN = await runAgentBatch(agents, debateQ, 50, makeProgress("Cluster Debate", round));
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    updateProgress({ roundAvg: Math.round(rNAvg), roundAvgs: [...roundAvgs], lastLog: `R${round} debate: ${rN.length} agents, avg ${Math.round(rNAvg)}%. Bull: ${clusters.bullCluster.size}, Bear: ${clusters.bearCluster.size}`, phase: round >= 8 ? "final" : "cluster" });
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });

    // Update clusters for next round
    const roundPreds = allLogs.filter((l) => l.round === round);
    const newClusters = analyzeClusters(roundPreds.map((l) => ({ probability: l.probability, confidence: l.confidence, reasoning: l.reasoning })));
    clusters.bullCluster = newClusters.bullCluster;
    clusters.bearCluster = newClusters.bearCluster;
    clusters.undecided = newClusters.undecided;
  }

  // ─── Rounds 9-10: Final Calibration ───
  console.log("[Swarm] Rounds 9-10: Final calibration...");
  const trajectory = roundAvgs.join("% → ") + "%";

  for (let round = 9; round <= 10; round++) {
    const finalQ = `${baseQ}\n\nFINAL CALIBRATION (Round ${round}):\nConsensus trajectory across 8 rounds: ${trajectory}\nCurrent consensus: ${roundAvgs[roundAvgs.length - 1]}%\nPolymarket price: ${pct}%\n\nThis is your final prediction. Be as calibrated as possible. Consider: is the Polymarket price too high, too low, or about right? Why?`;

    // Lower temperature for final rounds
    const finalAgents = agents.map((a) => ({ ...a, temperature: Math.min(a.temperature, 0.5) }));
    const rN = await runAgentBatch(finalAgents, finalQ, 50, makeProgress("Final Calibration", round));
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    updateProgress({ roundAvg: Math.round(rNAvg), roundAvgs: [...roundAvgs], lastLog: `R${round} final: ${rN.length} agents, avg ${Math.round(rNAvg)}%` });
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });
  }

  // ─── Aggregation ───
  updateProgress({ phase: "aggregate", status: "Aggregating results + calculating edge...", lastLog: "All 10 rounds complete. Aggregating..." });
  console.log("[Swarm] Aggregating results...");

  // Round weights: later rounds count more
  const roundWeights = [1, 1, 2, 2, 2, 3, 3, 3, 5, 5];

  // Consistency scoring: agents with low variance across rounds are more reliable
  const agentConsistency: Map<string, number> = new Map();
  for (const [key, history] of agentHistory) {
    if (history.length < 3) continue;
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
    const consistency = Math.max(0, 1 - Math.sqrt(variance) / 30); // 0-1, higher = more consistent
    agentConsistency.set(key, consistency);
  }

  let wSum = 0;
  let wTotal = 0;
  let confSum = 0;
  let confCount = 0;

  for (const log of allLogs) {
    const roundWeight = roundWeights[log.round - 1] || 1;
    const key = `${log.archetype}-${allLogs.filter((l) => l.archetype === log.archetype && l.round === log.round).indexOf(log) % 10}`;
    const consistency = agentConsistency.get(key) || 0.5;

    const w = (log.confidence / 100) * roundWeight * (1 + consistency);
    wSum += log.probability * w;
    wTotal += w;

    if (log.round >= 9) {
      confSum += log.confidence;
      confCount++;
    }
  }

  const consensus = wTotal > 0 ? wSum / wTotal : 50;
  const avgConfidence = confCount > 0 ? confSum / confCount : 50;

  // Edge detection
  const marketPricePct = marketPrice * 100;
  const edge = consensus - marketPricePct;
  const absEdge = Math.abs(edge);
  const edgeDirection = edge > 2 ? "undervalued" : edge < -2 ? "overvalued" : "neutral";

  // Kelly criterion (simplified)
  const impliedProb = consensus / 100;
  const kellyScore = absEdge > 2 ? (impliedProb * (1 / marketPrice - 1) - (1 - impliedProb)) / (1 / marketPrice - 1) : 0;

  let recommendation = "NO EDGE";
  if (kellyScore > 0.05 && edge > 3) recommendation = "BUY YES";
  else if (kellyScore > 0.05 && edge < -3) recommendation = "BUY NO";
  else if (absEdge > 2) recommendation = "SLIGHT EDGE";

  // Consensus stability (how much the last 3 rounds agree)
  const last3 = roundAvgs.slice(-3);
  const stabilityRange = Math.max(...last3) - Math.min(...last3);
  const consensusStability = Math.max(0, Math.min(1, 1 - stabilityRange / 20));

  // Final cluster analysis from last round
  const finalPreds = allLogs.filter((l) => l.round === 10);
  const finalClusters = analyzeClusters(finalPreds.map((l) => ({ probability: l.probability, confidence: l.confidence, reasoning: l.reasoning })));

  // Save agent memories for future learning
  console.log("[Swarm] Saving agent memories...");
  await saveAgentMemory(
    finalPreds.map((l) => ({ archetype: l.archetype, probability: l.probability, reasoning: l.reasoning })),
    question.slice(0, 100)
  );

  // Apply historical calibration (13,868 resolved markets)
  const cal = calibrateSwarmPrediction(consensus, marketPrice);

  // Recalculate edge using calibrated consensus
  const calEdge = cal.calibrated - marketPricePct;
  const calAbsEdge = Math.abs(calEdge);
  const calDirection = calEdge > 2 ? "undervalued" : calEdge < -2 ? "overvalued" : "neutral";
  const calImplied = cal.calibrated / 100;
  const calKelly = calAbsEdge > 2 ? (calImplied * (1 / marketPrice - 1) - (1 - calImplied)) / (1 / marketPrice - 1) : 0;

  let calRecommendation = "NO EDGE";
  if (calKelly > 0.05 && calEdge > 3) calRecommendation = "BUY YES";
  else if (calKelly > 0.05 && calEdge < -3) calRecommendation = "BUY NO";
  else if (calAbsEdge > 2) calRecommendation = "SLIGHT EDGE";

  return {
    consensus: Math.round(consensus * 10) / 10,
    calibratedConsensus: cal.calibrated,
    calibrationAdjustment: cal.calibrationAdjustment,
    historicalBias: cal.historicalBias,
    marketPrice: marketPricePct,
    edge: Math.round(calEdge * 10) / 10,
    edgeDirection: calDirection,
    confidence: Math.round(avgConfidence),
    kellyScore: Math.round(calKelly * 1000) / 1000,
    recommendation: calRecommendation,
    agentCount: agents.length,
    rounds: 10,
    clusterAnalysis: finalClusters,
    roundProgression: roundAvgs,
    consensusStability: Math.round(consensusStability * 100) / 100,
    webContext: webContext.slice(0, 2000),
    agentLogs: allLogs,
  };
}
