"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const AGENTS = [
  {
    id: "analyst",
    name: "Market Analyst",
    emoji: "\ud83d\udcca",
    color: "#58a6ff",
    desc: "Looks at numbers, charts, and trading data. Thinks like a mathematician.",
    example: "\"This market has high volume and the price has been steady at 65% for a week. The data says Yes.\"",
  },
  {
    id: "political",
    name: "Political Strategist",
    emoji: "\ud83c\udfe8",
    color: "#bc8cff",
    desc: "Understands how politics and governments work. Knows who has power and why.",
    example: "\"Based on the political incentives involved, this outcome is unlikely. Politicians won't risk it.\"",
  },
  {
    id: "contrarian",
    name: "Contrarian Trader",
    emoji: "\ud83e\udd14",
    color: "#d29922",
    desc: "Always asks: what if everyone is wrong? Looks for things others miss.",
    example: "\"Everyone thinks Yes, but they're ignoring the risk of X happening. I'm going against the crowd.\"",
  },
  {
    id: "news",
    name: "News Analyst",
    emoji: "\ud83d\udcf0",
    color: "#3fb950",
    desc: "Tracks what's happening in the world RIGHT NOW. Breaking news changes everything.",
    example: "\"Breaking: a new development just happened that changes the odds significantly.\"",
  },
  {
    id: "risk",
    name: "Risk Assessor",
    emoji: "\u26a0\ufe0f",
    color: "#f85149",
    desc: "The careful one. Always asks: how confident are we really? What could go wrong?",
    example: "\"I'm only 60% sure. There's a 15% chance of a surprise outcome nobody is pricing in.\"",
  },
];

const STEPS = [
  {
    title: "1. Pick the Top Markets",
    desc: "We find the biggest Polymarket markets by trading volume \u2014 the ones where millions of dollars are at stake.",
    icon: "\ud83c\udfaf",
  },
  {
    title: "2. Round 1: Independent Predictions",
    desc: "20 AI agents with completely different personalities each make a prediction WITHOUT seeing anyone else's answer. Each agent runs at 5 creativity levels = 100 real predictions. Zero groupthink.",
    icon: "\ud83e\udde0",
  },
  {
    title: "3. Round 2: The Debate",
    desc: "Now all agents see the Round 1 results: the average prediction, the strongest bull argument, and the strongest bear argument. Each agent can change their mind or double down. The contrarian challenges everyone, the risk assessor flags overconfidence.",
    icon: "\ud83d\udde3\ufe0f",
  },
  {
    title: "4. Round 3: Final Vote",
    desc: "Agents see how the debate shifted the consensus and give their final, most carefully calibrated prediction. Round 3 votes count 3x more than Round 1. Another 100 predictions.",
    icon: "\ud83d\uddf3\ufe0f",
  },
  {
    title: "5. Bootstrap to 100,000",
    desc: "The 300 real predictions are resampled with statistical variation to simulate 100,000 agents. This gives the consensus mathematical weight. The final number is compared to the actual Polymarket price.",
    icon: "\ud83d\udcc8",
  },
];

export function SwarmDiagram() {
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div className="space-y-8">
      {/* Step-by-step process */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-4">How It Works (Step by Step)</h4>
        <div className="space-y-2">
          {STEPS.map((step, idx) => (
            <button
              key={idx}
              onClick={() => setActiveStep(idx)}
              className={cn(
                "w-full text-left p-3 rounded-lg border transition-all",
                activeStep === idx
                  ? "bg-[#58a6ff]/5 border-[#58a6ff]/30"
                  : "bg-[#0d1117] border-[#21262d] hover:border-[#30363d]"
              )}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl">{step.icon}</span>
                <div>
                  <p className={cn(
                    "text-sm font-medium",
                    activeStep === idx ? "text-white" : "text-[#adbac7]"
                  )}>
                    {step.title}
                  </p>
                  {activeStep === idx && (
                    <p className="text-sm text-[#768390] mt-1">{step.desc}</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive agent diagram */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-4">Meet the Agents</h4>
        <p className="text-sm text-[#768390] mb-4">
          Click on each agent to learn how they think. The magic is that they all look at the same question but reach different conclusions.
        </p>

        {/* Visual diagram */}
        <div className="relative bg-[#0d1117] rounded-lg border border-[#21262d] p-6">
          {/* Question at top */}
          <div className="text-center mb-6">
            <div className="inline-block bg-[#1c2128] border border-[#21262d] rounded-lg px-4 py-2">
              <p className="text-[10px] text-[#484f58] uppercase tracking-wider">Market Question</p>
              <p className="text-sm text-white font-medium">&quot;Will X happen by 2026?&quot;</p>
            </div>
            <div className="w-px h-4 bg-[#21262d] mx-auto" />
            <p className="text-[10px] text-[#484f58]">\u2193 sent to all 5 agents</p>
          </div>

          {/* Agents row */}
          <div className="grid grid-cols-5 gap-2 sm:gap-3 mb-6">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setActiveAgent(activeAgent === agent.id ? null : agent.id)}
                className={cn(
                  "flex flex-col items-center p-2 sm:p-3 rounded-lg border transition-all",
                  activeAgent === agent.id
                    ? "border-[color:var(--agent-color)] bg-[color:var(--agent-color)]/5"
                    : "border-[#21262d] hover:border-[#30363d]"
                )}
                style={{ "--agent-color": agent.color } as React.CSSProperties}
              >
                <span className="text-2xl">{agent.emoji}</span>
                <p className="text-[10px] text-[#adbac7] mt-1 text-center leading-tight hidden sm:block">
                  {agent.name}
                </p>
              </button>
            ))}
          </div>

          {/* Selected agent detail */}
          {activeAgent && (
            <div
              className="rounded-lg border p-4 mb-6 transition-all"
              style={{
                borderColor: AGENTS.find((a) => a.id === activeAgent)?.color + "40",
                backgroundColor: AGENTS.find((a) => a.id === activeAgent)?.color + "08",
              }}
            >
              {(() => {
                const agent = AGENTS.find((a) => a.id === activeAgent)!;
                return (
                  <div>
                    <p className="text-sm font-medium text-white">
                      {agent.emoji} {agent.name}
                    </p>
                    <p className="text-sm text-[#768390] mt-1">{agent.desc}</p>
                    <div className="mt-3 bg-[#0d1117] rounded p-3 border border-[#21262d]">
                      <p className="text-[10px] text-[#484f58] uppercase mb-1">Example thinking:</p>
                      <p className="text-xs text-[#adbac7] italic">{agent.example}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Arrows down to consensus */}
          <div className="flex justify-center gap-4 mb-3">
            {AGENTS.map((agent) => (
              <div key={agent.id} className="w-px h-6" style={{ backgroundColor: agent.color + "40" }} />
            ))}
          </div>
          <p className="text-[10px] text-[#484f58] text-center mb-3">\u2193 predictions combined (weighted by confidence)</p>

          {/* Consensus result */}
          <div className="text-center">
            <div className="inline-block bg-[#58a6ff]/10 border border-[#58a6ff]/30 rounded-lg px-6 py-3">
              <p className="text-[10px] text-[#58a6ff] uppercase tracking-wider">100,000 Agent Consensus (3 debate rounds)</p>
              <p className="text-2xl font-bold text-white mt-1">67% Yes</p>
              <p className="text-[10px] text-[#768390] mt-0.5">Round 1: 62% &rarr; Debate: 65% &rarr; Final: 67%</p>
              <p className="text-[10px] text-[#768390]">vs Market: 60% &mdash; AI says +7% higher</p>
            </div>
          </div>
        </div>
      </div>

      {/* Why it works */}
      <div>
        <h4 className="text-sm font-semibold text-white mb-3">Why Does This Work?</h4>
        <div className="space-y-3 text-sm text-[#768390]">
          <p>
            <strong className="text-[#adbac7]">Wisdom of crowds.</strong> When you ask one person a question, they might be wrong. But when you ask many different people and average their answers, the average is usually closer to the truth. Our AI agents are like a diverse crowd of experts.
          </p>
          <p>
            <strong className="text-[#adbac7]">Diverse perspectives.</strong> If all 5 agents thought the same way, combining them would be useless. The key is that each agent has a completely different way of analyzing the world. The contrarian challenges the consensus, the risk assessor keeps everyone honest.
          </p>
          <p>
            <strong className="text-[#adbac7]">Confidence weighting.</strong> An agent who says &quot;I&apos;m 90% sure&quot; gets more weight than one who says &quot;I&apos;m only 40% sure.&quot; This means the final number reflects both the prediction AND how confident each agent is.
          </p>
          <p>
            <strong className="text-[#adbac7]">Based on real research.</strong> The <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS framework</a> runs up to 1 million agents that simulate entire social networks &mdash; agents follow, argue, share, and influence each other just like real people. MiroFish uses hundreds of thousands of these agents to predict real-world outcomes. Our version is a simplified 5-agent model that trades scale for cost-efficiency, but applies the same core principle: diverse perspectives + weighted aggregation = better predictions.
          </p>
        </div>
      </div>
    </div>
  );
}
