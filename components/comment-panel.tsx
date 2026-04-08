"use client";

import type { Thread } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface CommentPanelProps {
  threads: Thread[];
  sessionId: string;
  onScrollToLine: (target: string | number) => void;
  newCommentText: string;
  onNewCommentTextChange: (text: string) => void;
  onCreateGeneralComment: (text: string) => void | Promise<void>;
  onDone: () => void | Promise<void>;
  doneLabel?: string;
  isDone: boolean;
  lockedMessage?: string;
  lockedActionLabel?: string;
  onLockedAction?: () => void | Promise<void>;
  statusMessage?: string | null;
  statusTone?: "default" | "warning" | "error";
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export function CommentPanel({
  threads,
  sessionId,
  onScrollToLine,
  newCommentText,
  onNewCommentTextChange,
  onCreateGeneralComment,
  onDone,
  doneLabel = "Done",
  isDone,
  lockedMessage,
  lockedActionLabel,
  onLockedAction,
  statusMessage,
  statusTone = "default",
}: CommentPanelProps) {
  const sorted = [...threads].sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="flex flex-col h-full">
      {/* General comment form + Done -- always at top */}
      <div className="border-b border-border p-4 shrink-0">
        {isDone ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {lockedMessage ?? "Review submitted. Waiting for the agent to update this session."}
            </p>
            {lockedActionLabel && onLockedAction && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={onLockedAction}
              >
                {lockedActionLabel}
              </Button>
            )}
          </div>
        ) : (
          <>
            <Textarea
              value={newCommentText}
              onChange={(e) => onNewCommentTextChange(e.target.value)}
              placeholder="General comment..."
              className="mb-2 bg-background text-sm min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onCreateGeneralComment(newCommentText)}
                disabled={!newCommentText.trim()}
              >
                Comment
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={async () => {
                  if (newCommentText.trim()) {
                    await onCreateGeneralComment(newCommentText);
                  }
                  await onDone();
                }}
              >
                {newCommentText.trim() ? `Comment & ${doneLabel}` : doneLabel}
              </Button>
            </div>
          </>
        )}
        {statusMessage && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs ${
              statusTone === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-200"
                : statusTone === "warning"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-border bg-muted/30 text-muted-foreground"
            }`}
          >
            {statusMessage}
          </div>
        )}
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Comments
          {threads.length > 0 && (
            <span className="ml-1.5 text-foreground">{threads.length}</span>
          )}
        </h2>

        {threads.length === 0 && (
          <p className="text-sm text-muted-foreground italic py-4">
            No comments yet.
          </p>
        )}

        {sorted.map((thread) => {
          const first = thread.messages[0];
          const isInline = thread.hunk_id != null || thread.line != null;
          const locationLabel = thread.file_path
            ? `${basename(thread.file_path)}:${thread.line}`
            : thread.hunk_id != null
              ? `H${thread.hunk_id}:${thread.line}`
              : thread.line != null
                ? `L${thread.line}`
                : "general";

          return (
            <button
              key={thread.id}
              className={`w-full text-left rounded-md px-3 py-2 hover:bg-muted/50 transition-colors ${thread.outdated ? "opacity-60" : ""}`}
              onClick={() => {
                if (isInline) {
                  onScrollToLine(thread.hunk_id ?? thread.file_path ?? thread.line!);
                }
              }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  #{thread.id}
                </span>
                <span className="text-[10px] font-mono uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {first.role}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate max-w-[140px]">
                  {locationLabel}
                </span>
                {thread.outdated && (
                  <Badge variant="outline" className="text-[9px] py-0 text-muted-foreground">
                    outdated
                  </Badge>
                )}
              </div>
              <p className="text-xs font-sans line-clamp-2 text-foreground/80">
                {first.text}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
