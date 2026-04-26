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
    id: "risk",
    name: "Risk Assessor",
    emoji: "\u26a0\ufe0f",
    color: "#f85149",
    desc: "The careful one. Always asks: how confident are we really? What could go wrong?",
    example: "\"I'm only 60% sure. There's a 15% chance of a surprise outcome nobody is pricing in.\"",
  },
  {
    id: "historian",
    name: "Historian",
    emoji: "\ud83d\udcdc",
    color: "#3fb950",
    desc: "Looks at how similar situations played out before. History rhymes more than it repeats.",
    example: "\"Every time this has happened in the past 30 years, the outcome was Yes about 70% of the time.\"",
  },
];

const STEPS = [
  {
    title: "1. Pick the Top Markets (daily, 06:00 UTC)",
    desc: "A Vercel cron picks the top 10 Polymarket markets ending within 1 day to 3 months, with $50K+ volume, prices between 5% and 95%, and category diversity (max 4 per category). Each market gets a row in the consensus_runs table for the day.",
    icon: "\ud83c\udfaf",
  },
  {
    title: "2. Step 1 \u2014 20 personas each do their OWN web search",
    desc: "All 20 personas run in parallel. Each one calls OpenAI's web_search_preview tool with a search-style hint matched to its perspective: the Historian searches for past analogues, the INTP Logician searches for verified primary sources, the ESFP Performer searches for media buzz, etc. Each persona then writes a probability + 3-5 bullets based on what it found. Saved to consensus_persona_predictions.",
    icon: "\ud83d\udd0e",
  },
  {
    title: "3. Step 2 \u2014 Re-assess after seeing the round-1 dataset (06:15 UTC)",
    desc: "A second cron picks up runs that finished step 1. The same 20 personas now see all 20 round-1 probabilities and bullets from the DB, and re-vote. No new web search \u2014 they reason off the round-1 dataset and decide whether to hold firm or update. 20 more rows saved.",
    icon: "\ud83d\udde3\ufe0f",
  },
  {
    title: "4. Step 3 \u2014 Bootstrap aggregation (06:30 UTC, no AI)",
    desc: "Pure JS, no OpenAI calls. We pull the 40 probabilities (rounds 1+2) and run 10,000 bootstrap resamples \u2014 each resample picks 40 values WITH REPLACEMENT and computes a mean. The distribution of those 10,000 means becomes the headline number plus its uncertainty.",
    icon: "\ud83d\udcca",
  },
  {
    title: "5. Report mean, 90% CI, and mode",
    desc: "The headline is the MEAN of the 10,000 bootstrapped means. The 5th and 95th percentile of the same distribution form a 90% confidence interval (shown as \u00b1X). The MODE is reported as a sanity check \u2014 it should sit very near the mean since the bootstrap distribution is approximately normal.",
    icon: "\ud83d\udcc8",
  },
  {
    title: "6. Cost + the admin escape hatch",
    desc: "Roughly 60 OpenAI calls per market (20 web searches + 40 chat completions) \u2248 $0.50/market = $5/day for the full top-10 run. The admin can also click 'Run Now' on /admin to wipe today's snapshot and re-run the whole pipeline inline.",
    icon: "\ud83d\udcb0",
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
        <h4 className="text-sm font-semibold text-white mb-4">Meet the Personas (5 of 20 shown)</h4>
        <p className="text-sm text-[#768390] mb-4">
          The full pipeline runs 20 personas — the 5 originals below plus 15 MBTI-inspired archetypes (INTJ Architect, ENTP Challenger, ESFP Performer, etc.). Each one not only THINKS differently, it also SEARCHES the web differently — a Historian asks Google about precedents, an INTP Logician asks for primary-source data. Click an agent to see how they reason.
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
            <p className="text-[10px] text-[#484f58]">&darr; sent to all 20 personas (5 representatives shown)</p>
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
          <p className="text-[10px] text-[#484f58] text-center mb-3">&darr; 40 votes (20 personas &times; 2 rounds) &rarr; 10K bootstrap resamples</p>

          {/* Consensus result */}
          <div className="text-center">
            <div className="inline-block bg-[#58a6ff]/10 border border-[#58a6ff]/30 rounded-lg px-6 py-3">
              <p className="text-[10px] text-[#58a6ff] uppercase tracking-wider">20-Persona Bootstrap (2 rounds &middot; 10K resamples)</p>
              <p className="text-2xl font-bold text-white mt-1">67% &plusmn; 4%</p>
              <p className="text-[10px] text-[#768390] mt-0.5">Mean 67% &middot; mode 67% &middot; 90% CI [63%, 71%]</p>
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
            <strong className="text-[#adbac7]">Wisdom of crowds.</strong> When you ask one person a question, they might be wrong. But when you ask many different people and average their answers, the average is usually closer to the truth. We use 20 different AI personas as a diverse crowd of experts.
          </p>
          <p>
            <strong className="text-[#adbac7]">Diverse perspectives AND diverse research.</strong> If all 20 personas thought the same way they&apos;d be useless. The key is that each one not only REASONS differently, it also SEARCHES the web differently. A Historian asks Google about precedents, an INTP Logician asks for primary-source data, an ESFP Performer asks what&apos;s viral on social. They surface fundamentally different facts before they vote.
          </p>
          <p>
            <strong className="text-[#adbac7]">Bootstrap aggregation gives a real confidence interval.</strong> Instead of fake-precise &ldquo;67%&rdquo; we resample the 40 persona votes 10,000 times and report the spread of resampled means. When the 20 personas mostly agree, the band is tight (e.g. 67 &plusmn; 2%). When they disagree wildly, the band widens (67 &plusmn; 12%) and you can see it in the headline. The mode is reported as a sanity check &mdash; bootstrap distributions are approximately normal so mode and mean should land within ~0.5% of each other.
          </p>
          <p>
            <strong className="text-[#adbac7]">Inspired by, not equal to, real research.</strong> The <a href="https://arxiv.org/abs/2411.11581" target="_blank" className="text-[#58a6ff] hover:underline">OASIS framework</a> simulates up to 1 million social-network agents that follow, argue, and influence each other. Our 20-persona setup is much simpler &mdash; we trade their scale for cost (~$5/day) and latency (one daily snapshot via cron). Same core principle though: diverse perspectives + statistical aggregation = better predictions than any single AI guess.
          </p>
        </div>
      </div>
    </div>
  );
}
