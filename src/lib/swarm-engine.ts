import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

async function gatherKnowledge(question: string): Promise<string> {
  const searches = [
    `Latest polls and predictions for: ${question}`,
    `Legal issues, scandals, or controversies related to: ${question}`,
    `Endorsements, fundraising, and campaign strength for: ${question}`,
    `Historical precedents and base rates for similar elections to: ${question}`,
    `Voter demographics, turnout expectations, and ground game for: ${question}`,
  ];

  const results = await Promise.all(
    searches.map(async (query) => {
      try {
        const response = await openai.responses.create({
          model: "gpt-4o-mini",
          tools: [{ type: "web_search_preview" }],
          input: `Search the web and provide a concise factual summary (4-6 bullet points) of the most relevant recent information for: "${query}"\n\nFocus on FACTS and DATA only — polling numbers, endorsement names, dollar amounts, dates, legal rulings. No opinions or predictions. Include dates where possible.`,
        });
        const textOutput = response.output.find((o) => o.type === "message");
        if (textOutput && textOutput.type === "message") {
          const textContent = textOutput.content.find((c) => c.type === "output_text");
          if (textContent && textContent.type === "output_text") {
            return textContent.text.slice(0, 800);
          }
        }
        return "";
      } catch {
        return "";
      }
    })
  );

  const combined = results.filter(Boolean).join("\n\n---\n\n");
  return combined.slice(0, 4000); // Cap total context
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

// ─── Call a single agent ───

async function callAgent(systemPrompt: string, userMsg: string, temp: number): Promise<AgentPrediction | null> {
  try {
    const res = await openai.chat.completions.create({
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
    return null;
  }
}

// ─── Run agents in batches to avoid rate limits ───

async function runAgentBatch(
  agents: AgentProfile[],
  userMsg: string,
  batchSize: number = 40
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
  agentCount: number = 200
): Promise<SwarmResult> {
  const pct = (marketPrice * 100).toFixed(0);

  // Phase 1: Deep knowledge gathering
  console.log("[Swarm] Phase 1: Gathering knowledge...");
  const webContext = await gatherKnowledge(question);

  // Phase 2: Generate agents
  console.log(`[Swarm] Phase 2: Generating ${agentCount} agents...`);
  const agents = generateAgents(agentCount);

  const baseQ = `Market: "${question}"\nCurrent Polymarket Price: Yes ${pct}%\n\nLIVE RESEARCH CONTEXT:\n${webContext}\n\nPredict the TRUE probability of YES (0-100), your confidence (0-100), and reasoning. JSON only:\n{"probability":<0-100>,"confidence":<0-100>,"reasoning":"<1-2 sentences>"}`;

  const allLogs: SwarmResult["agentLogs"] = [];
  const roundAvgs: number[] = [];

  // Track per-agent predictions across rounds for consistency scoring
  const agentHistory: Map<string, number[]> = new Map();

  // ─── Rounds 1-2: Independent Analysis ───
  console.log("[Swarm] Rounds 1-2: Independent analysis...");
  const r1 = await runAgentBatch(agents, baseQ);
  const r1Avg = r1.reduce((s, p) => s + p.probability, 0) / (r1.length || 1);
  roundAvgs.push(Math.round(r1Avg));
  r1.forEach((p, i) => {
    allLogs.push({ archetype: p.archetype, round: 1, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
    const key = `${p.archetype}-${i % 10}`;
    agentHistory.set(key, [p.probability]);
  });

  const r2 = await runAgentBatch(agents, baseQ);
  const r2Avg = r2.reduce((s, p) => s + p.probability, 0) / (r2.length || 1);
  roundAvgs.push(Math.round(r2Avg));
  r2.forEach((p, i) => {
    allLogs.push({ archetype: p.archetype, round: 2, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
    const key = `${p.archetype}-${i % 10}`;
    agentHistory.get(key)?.push(p.probability);
  });

  // ─── Rounds 3-5: Information Sharing ───
  console.log("[Swarm] Rounds 3-5: Information sharing...");
  const allR12 = [...r1, ...r2];
  const stdDev = Math.sqrt(allR12.reduce((s, p) => s + (p.probability - r2Avg) ** 2, 0) / (allR12.length || 1));
  const topBull = allR12.sort((a, b) => b.probability - a.probability).slice(0, 5);
  const topBear = allR12.sort((a, b) => a.probability - b.probability).slice(0, 5);
  const sharedReasons = [...topBull.slice(0, 3), ...topBear.slice(0, 3)].map((p) => `[${p.archetype}]: ${p.reasoning}`).join("\n");

  for (let round = 3; round <= 5; round++) {
    const infoQ = `${baseQ}\n\nSOCIAL CONTEXT (Round ${round}):\nPrevious rounds average: ${roundAvgs[roundAvgs.length - 1]}% (std dev: ${stdDev.toFixed(0)}%)\nHighest prediction: ${topBull[0]?.probability}%, Lowest: ${topBear[0]?.probability}%\n\nPeer reasoning shared on the forum:\n${sharedReasons}\n\nUpdate your prediction considering this information.`;

    const rN = await runAgentBatch(agents, infoQ);
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });
  }

  // ─── Rounds 6-8: Cluster Formation ───
  console.log("[Swarm] Rounds 6-8: Cluster formation...");
  const latestPredictions = allLogs.filter((l) => l.round === 5);
  const clusters = analyzeClusters(latestPredictions.map((l) => ({ probability: l.probability, confidence: l.confidence, reasoning: l.reasoning })));

  for (let round = 6; round <= 8; round++) {
    const clusterQ = `${baseQ}\n\nCLUSTER ANALYSIS (Round ${round}):\nCurrent consensus: ${roundAvgs[roundAvgs.length - 1]}%\n\nBULL CLUSTER (${clusters.bullCluster.size} agents, avg ${clusters.bullCluster.avgPrediction}%): "${clusters.bullCluster.topArgument}"\nBEAR CLUSTER (${clusters.bearCluster.size} agents, avg ${clusters.bearCluster.avgPrediction}%): "${clusters.bearCluster.topArgument}"\nUNDECIDED (${clusters.undecided.size} agents)\n\nConsider which cluster's argument is stronger. Give your final prediction.`;

    const rN = await runAgentBatch(agents, clusterQ);
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });
  }

  // ─── Rounds 9-10: Final Calibration ───
  console.log("[Swarm] Rounds 9-10: Final calibration...");
  const trajectory = roundAvgs.join("% → ") + "%";

  for (let round = 9; round <= 10; round++) {
    const finalQ = `${baseQ}\n\nFINAL CALIBRATION (Round ${round}):\nConsensus trajectory across 8 rounds: ${trajectory}\nCurrent consensus: ${roundAvgs[roundAvgs.length - 1]}%\nPolymarket price: ${pct}%\n\nThis is your final prediction. Be as calibrated as possible. Consider: is the Polymarket price too high, too low, or about right? Why?`;

    // Lower temperature for final rounds
    const finalAgents = agents.map((a) => ({ ...a, temperature: Math.min(a.temperature, 0.5) }));
    const rN = await runAgentBatch(finalAgents, finalQ);
    const rNAvg = rN.reduce((s, p) => s + p.probability, 0) / (rN.length || 1);
    roundAvgs.push(Math.round(rNAvg));
    rN.forEach((p, i) => {
      allLogs.push({ archetype: p.archetype, round, probability: p.probability, confidence: p.confidence, reasoning: p.reasoning });
      const key = `${p.archetype}-${i % 10}`;
      agentHistory.get(key)?.push(p.probability);
    });
  }

  // ─── Aggregation ───
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

  return {
    consensus: Math.round(consensus * 10) / 10,
    marketPrice: marketPricePct,
    edge: Math.round(edge * 10) / 10,
    edgeDirection,
    confidence: Math.round(avgConfidence),
    kellyScore: Math.round(kellyScore * 1000) / 1000,
    recommendation,
    agentCount: agents.length,
    rounds: 10,
    clusterAnalysis: finalClusters,
    roundProgression: roundAvgs,
    consensusStability: Math.round(consensusStability * 100) / 100,
    webContext: webContext.slice(0, 2000),
    agentLogs: allLogs,
  };
}
