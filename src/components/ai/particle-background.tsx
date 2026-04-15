"use client";

import { SwarmVisualization } from "./swarm-visualization";

/**
 * Fixed-viewport particle background — same plexus-dot animation as
 * the News page. Put page content inside a `relative z-10` wrapper so
 * it paints above.
 */
export function ParticleBackground({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity }}
      aria-hidden="true"
    >
      <SwarmVisualization className="h-screen" />
    </div>
  );
}
