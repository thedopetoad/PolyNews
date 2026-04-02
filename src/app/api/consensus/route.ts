import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Agent personas inspired by OASIS framework.
 * Each has a distinct expertise, risk profile, and reasoning style.
 * The diversity of perspectives is what creates emergent consensus.
 */
const AGENT_PERSONAS = [
  {
    name: "Market Analyst",
    systemPrompt: `You are a quantitative market analyst. You focus on market data, trading volume, price momentum, and historical patterns. You are data-driven and skeptical of narratives. You weight your predictions based on observable market signals.`,
  },
  {
    name: "Political Strategist",
    systemPrompt: `You are a political strategist with deep knowledge of US and international politics. You understand polling, voter behavior, legislative dynamics, and geopolitical power structures. You focus on political incentives and institutional behavior.`,
  },
  {
    name: "Contrarian Trader",
    systemPrompt: `You are a contrarian trader. You look for where the crowd is wrong. When consensus is too strong in one direction, you consider the opposite. You focus on overlooked risks, black swan scenarios, and mean reversion. You often disagree with the majority.`,
  },
  {
    name: "News Analyst",
    systemPrompt: `You are a news and media analyst. You track breaking news, media narratives, and information flow. You understand how news cycles affect public opinion and markets. You weight recent developments heavily and consider information asymmetry.`,
  },
  {
    name: "Risk Assessor",
    systemPrompt: `You are a risk assessment specialist. You focus on probability calibration, tail risks, and uncertainty. You are careful about overconfidence and always consider what could go wrong. You provide well-calibrated probability ranges rather than point estimates.`,
  },
];

interface AgentPrediction {
  agent: string;
  probability: number; // 0-100
  confidence: number; // 0-100
  reasoning: string;
}

async function getAgentPrediction(
  persona: (typeof AGENT_PERSONAS)[number],
  marketQuestion: string,
  currentYesPrice: number
): Promise<AgentPrediction> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0.7,
      messages: [
        { role: "system", content: persona.systemPrompt },
        {
          role: "user",
          content: `Prediction market question: "${marketQuestion}"

Current market price: Yes ${(currentYesPrice * 100).toFixed(0)}% / No ${((1 - currentYesPrice) * 100).toFixed(0)}%

What is your predicted probability that the answer is YES? Also rate your confidence (0-100) in your prediction.

Respond ONLY in this exact JSON format, nothing else:
{"probability": <number 0-100>, "confidence": <number 0-100>, "reasoning": "<one sentence>"}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(content);

    return {
      agent: persona.name,
      probability: Math.max(0, Math.min(100, Number(parsed.probability) || 50)),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      reasoning: String(parsed.reasoning || "No reasoning provided").slice(0, 200),
    };
  } catch {
    // Fallback if agent fails
    return {
      agent: persona.name,
      probability: currentYesPrice * 100,
      confidence: 30,
      reasoning: "Unable to generate prediction",
    };
  }
}

function aggregateConsensus(predictions: AgentPrediction[]) {
  // Weighted average by confidence
  let totalWeight = 0;
  let weightedSum = 0;

  for (const p of predictions) {
    const weight = p.confidence / 100;
    weightedSum += p.probability * weight;
    totalWeight += weight;
  }

  const consensus = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Overall confidence = average confidence scaled by agreement
  const avgConfidence =
    predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

  // Measure agreement (lower spread = higher agreement)
  const probabilities = predictions.map((p) => p.probability);
  const mean = probabilities.reduce((a, b) => a + b, 0) / probabilities.length;
  const variance =
    probabilities.reduce((sum, p) => sum + (p - mean) ** 2, 0) /
    probabilities.length;
  const stdDev = Math.sqrt(variance);
  const agreementFactor = Math.max(0, 1 - stdDev / 50); // 0 = total disagreement, 1 = perfect agreement

  return {
    consensus: Math.round(consensus * 10) / 10,
    confidence: Math.round(avgConfidence * agreementFactor),
    spread: Math.round(stdDev * 10) / 10,
    predictions,
  };
}

// POST /api/consensus - Run swarm consensus on a market
export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { marketQuestion, currentYesPrice } = body;

    if (!marketQuestion || typeof currentYesPrice !== "number") {
      return NextResponse.json(
        { error: "Missing marketQuestion or currentYesPrice" },
        { status: 400 }
      );
    }

    // Run all agents in parallel
    const predictions = await Promise.all(
      AGENT_PERSONAS.map((persona) =>
        getAgentPrediction(persona, marketQuestion, currentYesPrice)
      )
    );

    const result = aggregateConsensus(predictions);

    // Determine trend vs market price
    const marketPercent = currentYesPrice * 100;
    const diff = result.consensus - marketPercent;
    const trend = diff > 3 ? "up" : diff < -3 ? "down" : "flat";

    return NextResponse.json({
      consensus: result.consensus,
      confidence: result.confidence,
      spread: result.spread,
      trend,
      agents: result.predictions,
    });
  } catch {
    return NextResponse.json(
      { error: "Consensus generation failed" },
      { status: 500 }
    );
  }
}
