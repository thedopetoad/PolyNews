import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 20 agent personas - 5x more diverse than before.
 * Each runs at 5 different temperatures = 100 real predictions.
 * Those 100 are bootstrapped to simulate 10,000 agents.
 */
const AGENT_PERSONAS = [
  { name: "Market Analyst", prompt: "You are a quantitative market analyst. Focus on trading volume, price momentum, and historical patterns. Data-driven, skeptical of narratives." },
  { name: "Political Strategist", prompt: "You are a political strategist. Focus on political incentives, polling data, legislative dynamics, and institutional behavior." },
  { name: "Contrarian Trader", prompt: "You are a contrarian. Look for where the crowd is wrong. When consensus is strong, consider the opposite. Focus on overlooked risks." },
  { name: "News Analyst", prompt: "You are a news analyst. Track breaking developments and media narratives. Weight recent events heavily." },
  { name: "Risk Assessor", prompt: "You are a risk specialist. Focus on probability calibration and tail risks. Be careful about overconfidence." },
  { name: "Geopolitical Expert", prompt: "You are a geopolitical analyst. Focus on international relations, power dynamics, treaties, and military strategy." },
  { name: "Economist", prompt: "You are a macroeconomist. Focus on GDP, inflation, employment, monetary policy, and fiscal trends." },
  { name: "Tech Analyst", prompt: "You are a technology industry analyst. Focus on product launches, AI progress, regulatory actions, and market disruption." },
  { name: "Behavioral Psychologist", prompt: "You are a behavioral psychologist. Focus on cognitive biases, crowd psychology, panic/euphoria cycles, and sentiment." },
  { name: "Statistician", prompt: "You are a pure statistician. Focus on base rates, Bayesian reasoning, regression to the mean, and sample sizes." },
  { name: "Investigative Journalist", prompt: "You are an investigative journalist. Look for hidden information, conflicts of interest, and what powerful people don't want known." },
  { name: "Insurance Actuary", prompt: "You are an insurance actuary. Calculate precise probabilities based on historical data and statistical models. Very conservative." },
  { name: "Venture Capitalist", prompt: "You are a venture capitalist. Focus on disruption potential, exponential trends, and paradigm shifts. Optimistic about change." },
  { name: "Military Strategist", prompt: "You are a military strategist. Focus on deterrence, escalation dynamics, capability vs intent, and war gaming scenarios." },
  { name: "Climate Scientist", prompt: "You are a climate scientist. Focus on environmental data, policy implementation, energy transitions, and scientific consensus." },
  { name: "Crypto Trader", prompt: "You are a crypto trader. Focus on market cycles, whale movements, regulatory signals, and on-chain data." },
  { name: "Historian", prompt: "You are a historian. Focus on historical precedents, pattern recognition across centuries, and how similar situations played out before." },
  { name: "Legal Scholar", prompt: "You are a legal scholar. Focus on constitutional law, court precedents, regulatory frameworks, and legal strategy." },
  { name: "Sociologist", prompt: "You are a sociologist. Focus on social movements, demographic trends, cultural shifts, and public opinion formation." },
  { name: "Devil's Advocate", prompt: "You MUST argue against the most popular position. If the market says Yes, argue No. Challenge every assumption. Be deliberately contrarian." },
];

const TEMPERATURES = [0.4, 0.6, 0.8, 1.0, 1.2];

interface AgentPrediction {
  agent: string;
  probability: number;
  confidence: number;
  reasoning: string;
}

async function getAgentPrediction(
  persona: { name: string; prompt: string },
  marketQuestion: string,
  currentYesPrice: number,
  temperature: number
): Promise<AgentPrediction> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature,
      messages: [
        { role: "system", content: persona.prompt },
        {
          role: "user",
          content: `Market: "${marketQuestion}"\nCurrent price: Yes ${(currentYesPrice * 100).toFixed(0)}%\n\nPredict probability YES (0-100) and confidence (0-100). JSON only:\n{"probability": <0-100>, "confidence": <0-100>, "reasoning": "<one sentence>"}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(content);
    return {
      agent: persona.name,
      probability: Math.max(0, Math.min(100, Number(parsed.probability) || 50)),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      reasoning: String(parsed.reasoning || "").slice(0, 150),
    };
  } catch {
    return {
      agent: persona.name,
      probability: currentYesPrice * 100,
      confidence: 20,
      reasoning: "Unable to generate prediction",
    };
  }
}

function bootstrapConsensus(predictions: AgentPrediction[], sampleSize: number = 10000) {
  // Bootstrap: resample with replacement to simulate larger swarm
  const bootstrapped: number[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(Math.random() * predictions.length);
    const p = predictions[idx];
    // Add slight noise to simulate agent variation
    const noise = (Math.random() - 0.5) * 4;
    bootstrapped.push(Math.max(0, Math.min(100, p.probability + noise)));
  }

  // Weighted consensus from original predictions
  let totalWeight = 0;
  let weightedSum = 0;
  for (const p of predictions) {
    const w = p.confidence / 100;
    weightedSum += p.probability * w;
    totalWeight += w;
  }
  const consensus = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Stats from bootstrap distribution
  const mean = bootstrapped.reduce((a, b) => a + b, 0) / bootstrapped.length;
  const variance = bootstrapped.reduce((s, v) => s + (v - mean) ** 2, 0) / bootstrapped.length;
  const stdDev = Math.sqrt(variance);

  // Confidence from agreement
  const avgConfidence = predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length;
  const agreementFactor = Math.max(0, 1 - stdDev / 50);

  // Group predictions by persona for display (show best 5)
  const byPersona = new Map<string, AgentPrediction[]>();
  for (const p of predictions) {
    if (!byPersona.has(p.agent)) byPersona.set(p.agent, []);
    byPersona.get(p.agent)!.push(p);
  }
  const summaryAgents: AgentPrediction[] = [];
  for (const [name, preds] of byPersona) {
    const avgProb = preds.reduce((s, p) => s + p.probability, 0) / preds.length;
    const avgConf = preds.reduce((s, p) => s + p.confidence, 0) / preds.length;
    const bestReasoning = preds.sort((a, b) => b.confidence - a.confidence)[0].reasoning;
    summaryAgents.push({
      agent: name,
      probability: Math.round(avgProb),
      confidence: Math.round(avgConf),
      reasoning: bestReasoning,
    });
  }
  // Sort by confidence, show top 5
  summaryAgents.sort((a, b) => b.confidence - a.confidence);

  return {
    consensus: Math.round(consensus * 10) / 10,
    confidence: Math.round(avgConfidence * agreementFactor),
    spread: Math.round(stdDev * 10) / 10,
    totalAgents: sampleSize,
    realPredictions: predictions.length,
    predictions: summaryAgents.slice(0, 5),
  };
}

// Cache
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;

// POST /api/consensus
export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { marketQuestion, currentYesPrice } = body;

    if (!marketQuestion || typeof currentYesPrice !== "number") {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Check cache
    const cacheKey = marketQuestion.toLowerCase().trim().slice(0, 100);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Run 20 personas × 5 temperatures = 100 real predictions
    // Batch in groups of 20 to avoid rate limits
    const allPredictions: AgentPrediction[] = [];

    for (const temp of TEMPERATURES) {
      const batch = await Promise.all(
        AGENT_PERSONAS.map((persona) =>
          getAgentPrediction(persona, marketQuestion, currentYesPrice, temp)
        )
      );
      allPredictions.push(...batch);
    }

    // Bootstrap to 10,000
    const result = bootstrapConsensus(allPredictions, 10000);

    const marketPercent = currentYesPrice * 100;
    const diff = result.consensus - marketPercent;
    const trend = diff > 3 ? "up" : diff < -3 ? "down" : "flat";

    const responseData = {
      consensus: result.consensus,
      confidence: result.confidence,
      spread: result.spread,
      trend,
      totalAgents: result.totalAgents,
      realPredictions: result.realPredictions,
      agents: result.predictions,
    };

    cache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    return NextResponse.json(responseData);
  } catch {
    return NextResponse.json({ error: "Consensus generation failed" }, { status: 500 });
  }
}
