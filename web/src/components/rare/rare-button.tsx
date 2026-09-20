"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type RareButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
};

export function RareButton({ variant = "primary", size = "md", className, children, ...props }: RareButtonProps) {
  return (
    <motion.button
      {...props}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98, y: 1 }}
      transition={{ duration: 0.16 }}
      className={cn("rare-button", `rare-button-${variant}`, `rare-button-${size}`, className)}
    >
      {children}
    </motion.button>
  );
}
