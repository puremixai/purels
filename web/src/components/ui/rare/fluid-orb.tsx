"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type FluidOrbProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
  color?: string;
};

export function FluidOrb({ size = 280, color = "var(--ui-accent)", className, style, ...props }: FluidOrbProps) {
  return (
    <div
      {...props}
      aria-hidden={props["aria-label"] ? undefined : true}
      data-slot="fluid-orb"
      className={cn("fluid-orb", className)}
      style={{ "--orb-size": `${size}px`, "--orb-color": color, ...style } as CSSProperties}
    >
      <span className="fluid-orb-glow" />
      <span className="fluid-orb-core" />
    </div>
  );
}
