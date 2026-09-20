"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type OtpStatus = "idle" | "success" | "error";

export type OtpInputProps = {
  length?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  type?: "numbers" | "letters" | "both";
  status?: OtpStatus;
  mask?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  className?: string;
};

const PATTERNS = {
  numbers: /^[0-9]$/,
  letters: /^[a-zA-Z]$/,
  both: /^[a-zA-Z0-9]$/,
} as const;

export function OtpInput({
  length = 6,
  value,
  defaultValue = "",
  onChange,
  onComplete,
  type = "numbers",
  status = "idle",
  mask = false,
  autoFocus = false,
  disabled = false,
  required = false,
  label = "One-time code",
  className,
}: OtpInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = value ?? internalValue;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function update(nextRaw: string) {
    const next = Array.from(nextRaw).filter((char) => PATTERNS[type].test(char)).join("").slice(0, length);
    if (value === undefined) setInternalValue(next);
    onChange?.(next);
    if (next.length === length) onComplete?.(next);
  }

  return (
    <div className={cn("rare-otp", className)} onClick={() => inputRef.current?.focus()}>
      <span className="sr-only">{label}</span>
      <input
        ref={inputRef}
        aria-label={label}
        autoComplete="one-time-code"
        className="rare-otp-input"
        disabled={disabled}
        inputMode={type === "numbers" ? "numeric" : "text"}
        maxLength={length}
        required={required}
        value={current}
        onChange={(event) => update(event.target.value)}
      />
      {Array.from({ length }, (_, index) => {
        const char = current[index] ?? "";
        return (
          <span key={index} data-status={status} className="rare-otp-slot">
            {char ? (mask ? "•" : char) : <span className="rare-otp-caret" aria-hidden="true" />}
          </span>
        );
      })}
    </div>
  );
}
