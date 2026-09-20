"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type CodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
};

export function CodeBlock({ code, language = "bash", filename, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div data-slot="code-block" className={cn("rare-code-block", className)}>
      <div className="rare-code-header">
        <span>{filename ?? language}</span>
        <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={copy} className="rare-code-copy">
          {copied ? "Copied" : "Copy"}
        </motion.button>
      </div>
      <pre className="rare-code-pre"><code>{code}</code></pre>
    </div>
  );
}
