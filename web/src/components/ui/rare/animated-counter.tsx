"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AnimatedCounterProps = {
  value: number;
  decimals?: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
};

export function AnimatedCounter({ value, decimals = 0, prefix, suffix, className }: AnimatedCounterProps) {
  const previous = useRef(value);
  const [display, setDisplay] = useState(value);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduceMotion || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplay,
    });
    return () => controls.stop();
  }, [reduceMotion, value]);

  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(display);

  return (
    <span className={cn("tabular-nums", className)} aria-live="polite">
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
