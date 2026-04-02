"use client";

export function BackgroundBeams({ className }: { className?: string }) {
  return (
    <div
      className={`fixed inset-0 pointer-events-none ${className || ""}`}
    >
      {/* Simple subtle gradient — no orbs, no animation */}
      <div className="absolute inset-0 bg-[oklch(0.07_0.005_260)]" />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.25 0.08 280), transparent)",
        }}
      />
    </div>
  );
}
