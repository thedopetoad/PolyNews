"use client";

import { SwarmVisualization, ParticleShape } from "./swarm-visualization";

/**
 * Fixed-viewport particle background. Drop at the top of a page to get the
 * same plexus animation as the News page, with a per-page sprite shape.
 *
 * Put page content inside a `relative z-10` wrapper so it paints above.
 */
export function ParticleBackground({
  shape = "dot",
  opacity = 0.35,
}: {
  shape?: ParticleShape;
  opacity?: number;
}) {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity }}
      aria-hidden="true"
    >
      <SwarmVisualization className="h-screen" shape={shape} />
    </div>
  );
}
