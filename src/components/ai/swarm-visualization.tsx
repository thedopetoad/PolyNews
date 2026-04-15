"use client";

import { useEffect, useRef, useCallback } from "react";

export type ParticleShape =
  | "dot"
  | "star"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "plus";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotationSpeed: number;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ParticleShape,
  p: Particle
) {
  const r = p.radius;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.beginPath();

  switch (shape) {
    case "dot":
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case "square":
      ctx.rect(-r, -r, r * 2, r * 2);
      break;
    case "triangle": {
      const h = r * 1.15;
      ctx.moveTo(0, -h);
      ctx.lineTo(h, h * 0.85);
      ctx.lineTo(-h, h * 0.85);
      ctx.closePath();
      break;
    }
    case "diamond":
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      break;
    case "star": {
      const spikes = 5;
      const outer = r;
      const inner = r * 0.45;
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (Math.PI * i) / spikes - Math.PI / 2;
        const rad = i % 2 === 0 ? outer : inner;
        const px = Math.cos(angle) * rad;
        const py = Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "hexagon": {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "plus": {
      const t = r * 0.38;
      ctx.rect(-r, -t, r * 2, t * 2);
      ctx.rect(-t, -r, t * 2, r * 2);
      break;
    }
  }

  ctx.fill();
  ctx.restore();
}

interface SwarmVisualizationProps {
  className?: string;
  shape?: ParticleShape;
  /** RGB triple as a string, e.g. "88, 166, 255". Default is PolyStream blue. */
  color?: string;
}

export function SwarmVisualization({
  className,
  shape = "dot",
  color = "88, 166, 255",
}: SwarmVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);

  const initParticles = useCallback(
    (width: number, height: number) => {
      // ~50% more particles than before (was capped at 60).
      const count = Math.min(90, Math.floor((width * height) / 7000));
      // Non-dot shapes need to be larger to be recognizable.
      const baseRadius = shape === "dot" ? 0.5 : 2;
      const variance = shape === "dot" ? 1.5 : 2.5;
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        radius: Math.random() * variance + baseRadius,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: shape === "dot" ? 0 : (Math.random() - 0.5) * 0.015,
      }));
    },
    [shape]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      initParticles(rect.width, rect.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        const cx = w / 2,
          cy = h / 2;
        const dx = cx - p.x,
          dy = cy - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 80) {
          p.vx += (dx / dist) * 0.001;
          p.vy += (dy / dist) * 0.001;
        }
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 1) {
          p.vx /= speed;
          p.vy /= speed;
        }
      }

      // Plexus connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            const alpha = (1 - dist / 100) * 0.12;
            ctx.strokeStyle = `rgba(${color}, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Shapes
      ctx.fillStyle = `rgba(${color}, 0.5)`;
      for (const p of particles) {
        drawShape(ctx, shape, p);
      }

      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [initParticles, shape, color]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className || ""}`}
      style={{ height: className?.includes("h-screen") ? "100vh" : 200 }}
    />
  );
}
