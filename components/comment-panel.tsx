"use client";

import type { Thread } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThreadView } from "@/components/thread-view";

interface CommentPanelProps {
  threads: Thread[];
  sessionId: string;
  onScrollToLine: (line: number) => void;
  newCommentText: string;
  onNewCommentTextChange: (text: string) => void;
  onCreateGeneralComment: (text: string) => void;
  onDone: () => void;
  replyTexts: Record<number, string>;
  onReplyTextChange: (threadId: number, text: string) => void;
  onReply: (threadId: number) => void;
  expandedThreads: Set<number>;
  onToggleThread: (id: number) => void;
  flashedMessages: Set<number>;
}

export function CommentPanel({
  threads,
  sessionId,
  onScrollToLine,
  newCommentText,
  onNewCommentTextChange,
  onCreateGeneralComment,
  onDone,
  replyTexts,
  onReplyTextChange,
  onReply,
  expandedThreads,
  onToggleThread,
  flashedMessages,
}: CommentPanelProps) {
  const sorted = [...threads].sort((a, b) => a.created_at - b.created_at);
  const inlineThreads = sorted.filter((t) => t.hunk_id != null || t.line != null);
  const generalThreads = sorted.filter((t) => t.hunk_id == null && t.line == null);

  return (
    <div className="flex flex-col h-full">
      {/* General comment form + Done — always at top */}
      <div className="border-b border-border p-4 shrink-0">
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
                onCreateGeneralComment(newCommentText);
              }
              onDone();
            }}
          >
            {newCommentText.trim() ? "Reply & Done" : "Done"}
          </Button>
        </div>
      </div>

      {/* Thread timeline */}
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

        {/* General threads — full ThreadView in panel */}
        {generalThreads.length > 0 && (
          <div className="space-y-1 mb-4">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-2 mb-1">
              General
            </h3>
            {generalThreads.map((thread) => (
              <ThreadView
                key={thread.id}
                thread={thread}
                expanded={expandedThreads.has(thread.id)}
                onToggle={() => onToggleThread(thread.id)}
                replyText={replyTexts[thread.id] ?? ""}
                onReplyTextChange={(text) => onReplyTextChange(thread.id, text)}
                onReply={() => onReply(thread.id)}
                flashedMessages={flashedMessages}
                className="rounded-md"
              />
            ))}
          </div>
        )}

        {/* Inline thread summaries — click to scroll */}
        {inlineThreads.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-2 mb-1">
              Inline
            </h3>
            {inlineThreads.map((thread) => {
              const first = thread.messages[0];
              const replyCount = thread.messages.length - 1;
              return (
                <button
                  key={thread.id}
                  className="w-full text-left rounded-md px-3 py-2 hover:bg-muted/50 transition-colors group"
                  onClick={() => {
                    onScrollToLine(thread.hunk_id ?? thread.line!);
                    onToggleThread(thread.id);
                  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {thread.hunk_id != null ? `H${thread.hunk_id}:${thread.line}` : `L${thread.line}`}
                    </span>
                    <Badge
                      variant={first.role === "human" ? "default" : "secondary"}
                      className="text-[9px] py-0"
                    >
                      {first.role}
                    </Badge>
                    {replyCount > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {replyCount} {replyCount === 1 ? "reply" : "replies"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-sans line-clamp-2 text-foreground/80">
                    {first.text}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
