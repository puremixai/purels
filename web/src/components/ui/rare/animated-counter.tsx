"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/components/i18n-provider";
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
  const locale = useLocale();

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduceMotion || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplay,
    });
    return () => controls.stop();
  }, [reduceMotion, value]);

  // Grouping and separators are locale-specific, and the console switches between
  // en and zh-CN: formatting with the runtime default would let the number's
  // shape ignore the language the rest of the page is in.
  const format = (input: number) => new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(input);

  return (
    <>
      <span aria-hidden="true" className={cn("tabular-nums", className)}>
        {prefix}
        {format(display)}
        {suffix}
      </span>
      {/* A reader that arrives mid-count would otherwise be told an intermediate
          figure, and one that stays would hear every frame. The settled value is
          the only thing worth announcing. */}
      <span className="sr-only">
        {prefix}
        {format(value)}
        {suffix}
      </span>
    </>
  );
}
