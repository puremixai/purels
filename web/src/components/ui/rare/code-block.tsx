"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast-provider";
import { cn } from "@/lib/utils";

export type CodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
};

export function CodeBlock({ code, language = "bash", filename, className }: CodeBlockProps) {
  const t = useT();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ kind: "success", title: t("common.copied") });
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
          {copied ? t("common.copied") : t("common.copy")}
        </motion.button>
      </div>
      <pre className="rare-code-pre"><code>{code}</code></pre>
    </div>
  );
}
