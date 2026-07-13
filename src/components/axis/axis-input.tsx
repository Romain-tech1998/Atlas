"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AxisInputProps {
  onSubmit: (rawInput: string) => Promise<void>;
  isSubmitting: boolean;
  placeholder: string;
  submitLabel: string;
  submittingLabel?: string;
  rows?: number;
}

export function AxisInput({
  onSubmit,
  isSubmitting,
  placeholder,
  submitLabel,
  submittingLabel = submitLabel,
  rows = 3,
}: AxisInputProps) {
  const [rawInput, setRawInput] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = rawInput.trim();
    if (!trimmed || isSubmitting) return;

    await onSubmit(trimmed);
    setRawInput("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Textarea
        value={rawInput}
        onChange={(event) => setRawInput(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={isSubmitting}
      />
      <Button type="submit" disabled={isSubmitting || rawInput.trim().length === 0} className="self-end">
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
