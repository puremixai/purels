"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

export type ScrollProgressProps = {
  className?: string;
};

export function ScrollProgress({ className }: ScrollProgressProps) {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });

  return (
    <motion.div
      aria-hidden="true"
      className={cn("rare-scroll-progress", className)}
      style={{ scaleX: reduceMotion ? scrollYProgress : smoothProgress }}
    />
  );
}
