"use client";

import type { Thread } from "@/worker/session";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function ThreadView({
  thread,
  expanded,
  onToggle,
  replyText,
  onReplyTextChange,
  onReply,
  flashedMessages,
  className,
}: {
  thread: Thread;
  expanded: boolean;
  onToggle: () => void;
  replyText: string;
  onReplyTextChange: (text: string) => void;
  onReply: () => void;
  flashedMessages: Set<number>;
  className?: string;
}) {
  const firstMessage = thread.messages[0];
  const replyCount = thread.messages.length - 1;

  return (
    <div className={`border-t border-border bg-muted/10 ${className ?? ""}`}>
      {/* Thread header -- first message */}
      <button
        className="w-full text-left px-4 py-2 hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start gap-2">
          <Badge
            variant={firstMessage.role === "human" ? "default" : "secondary"}
            className="text-[10px] shrink-0 mt-0.5"
          >
            {firstMessage.role}
          </Badge>
          <p className="text-sm font-sans flex-1 line-clamp-2">
            {firstMessage.text}
          </p>
          {replyCount > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
        </div>
      </button>

      {/* Expanded thread */}
      {expanded && (
        <div className="px-4 pb-3">
          {thread.messages.slice(1).map((msg) => (
            <div
              key={msg.id}
              className={`py-2 border-t border-border/30 transition-colors duration-1000 ${
                flashedMessages.has(msg.id)
                  ? "bg-primary/10"
                  : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <Badge
                  variant={msg.role === "human" ? "default" : "secondary"}
                  className="text-[10px] shrink-0 mt-0.5"
                >
                  {msg.role}
                </Badge>
                <p className="text-sm font-sans">{msg.text}</p>
              </div>
            </div>
          ))}

          {/* Reply form */}
          <div className="mt-2 flex gap-2">
            <Textarea
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              placeholder="Reply..."
              className="bg-background font-sans text-sm min-h-[40px] flex-1"
              rows={1}
            />
            <Button
              size="sm"
              onClick={onReply}
              disabled={!replyText.trim()}
              className="self-end"
            >
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
