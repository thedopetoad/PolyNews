"use client";

import { motion, useInView } from "motion/react";
import { useRef, CSSProperties } from "react";

export function TextGenerateEffect({
  words,
  className,
  style,
}: {
  words: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const wordArray = words.split(" ");

  return (
    <motion.div ref={ref} className={className} style={style}>
      {wordArray.map((word, idx) => (
        <motion.span
          key={`${word}-${idx}`}
          className="inline-block mr-[0.25em]"
          initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
          animate={
            isInView
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : {}
          }
          transition={{
            duration: 0.4,
            delay: idx * 0.08,
            ease: "easeOut",
          }}
        >
          {word}
        </motion.span>
      ))}
    </motion.div>
  );
}
