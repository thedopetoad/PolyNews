"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface Sparkle {
  id: string;
  x: number;
  y: number;
  size: number;
  delay: number;
}

function generateSparkle(): Sparkle {
  return {
    id: Math.random().toString(36).substring(2, 8),
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 2,
  };
}

export function SparklesEffect({
  count = 20,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    const initial = Array.from({ length: count }, () => generateSparkle());
    setSparkles(initial);

    const interval = setInterval(() => {
      setSparkles((prev) => {
        const updated = [...prev];
        const idx = Math.floor(Math.random() * updated.length);
        updated[idx] = generateSparkle();
        return updated;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [count]);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className || ""}`}>
      <AnimatePresence>
        {sparkles.map((sparkle) => (
          <motion.div
            key={sparkle.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${sparkle.x}%`,
              top: `${sparkle.y}%`,
              width: sparkle.size,
              height: sparkle.size,
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 1, 0] }}
            transition={{
              duration: 2,
              delay: sparkle.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
