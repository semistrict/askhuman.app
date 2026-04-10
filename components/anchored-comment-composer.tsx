"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AnchoredCommentComposer({
  value,
  onChange,
  onSubmit,
  onClose,
  placeholder,
  submitLabel = "Comment",
  quote,
  className,
  style,
  submitButtonTestId,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  placeholder: string;
  submitLabel?: string;
  quote?: string | null;
  className?: string;
  style?: CSSProperties;
  submitButtonTestId?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border/80 bg-card/95 p-3 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.65)] backdrop-blur ${className ?? ""}`}
      style={style}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Comment</div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {quote ? (
        <div className="mb-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground/85">
          “{quote}”
        </div>
      ) : null}
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mb-3 min-h-[84px] bg-background text-sm"
        autoFocus
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void onSubmit()}
          disabled={!value.trim()}
          data-testid={submitButtonTestId}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
