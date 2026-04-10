"use client";

import type { Thread } from "@/worker/session";
import { Badge } from "@/components/ui/badge";

export function ThreadView({
  thread,
  commentNumber,
  className,
  outdated,
}: {
  thread: Thread;
  commentNumber: number;
  className?: string;
  outdated?: boolean;
}) {
  const firstMessage = thread.messages[0];

  return (
    <div className={`border-t border-border bg-muted/10 px-4 py-2 ${outdated ? "opacity-60" : ""} ${className ?? ""}`}>
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 mt-0.5">
          #{commentNumber}
        </span>
        <span className="text-[10px] font-mono uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 mt-0.5">
          {firstMessage.role}
        </span>
        {outdated && (
          <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5 text-muted-foreground">
            outdated
          </Badge>
        )}
        <div className="flex-1 space-y-1">
          {thread.selection_text && (
            <div className="rounded border border-border/60 bg-background/70 px-2 py-1 text-xs font-sans italic text-foreground/80">
              “{thread.selection_text}”
            </div>
          )}
          <p className="text-sm font-sans">
            {firstMessage.text}
          </p>
        </div>
      </div>
    </div>
  );
}
