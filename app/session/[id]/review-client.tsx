"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread, Message } from "@/worker/plan-session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Props {
  sessionId: string;
  planLines: string[];
  initialThreads: Thread[];
}

export function ReviewClient({
  sessionId,
  planLines,
  initialThreads,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeLineThread, setActiveLineThread] = useState<number | null>(null);
  const [showGeneralForm, setShowGeneralForm] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [flashedMessages, setFlashedMessages] = useState<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/session/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "thread") {
        setThreads((prev) => {
          if (prev.some((t) => t.id === data.thread.id)) return prev;
          return [...prev, data.thread];
        });
      } else if (data.type === "message") {
        const msg: Message = data.message;
        setThreads((prev) =>
          prev.map((t) =>
            t.id === msg.thread_id
              ? t.messages.some((m) => m.id === msg.id)
                ? t
                : { ...t, messages: [...t.messages, msg] }
              : t
          )
        );
        // Flash new messages
        setFlashedMessages((prev) => new Set(prev).add(msg.id));
        setTimeout(() => {
          setFlashedMessages((prev) => {
            const next = new Set(prev);
            next.delete(msg.id);
            return next;
          });
        }, 2000);
        // Auto-expand thread with new message
        setExpandedThreads((prev) => new Set(prev).add(msg.thread_id));
      }
    });

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const createThread = useCallback(
    async (line: number | null, text: string) => {
      const res = await fetch(`/session/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line, text }),
      });
      const thread: Thread = await res.json();
      // WS will handle adding it to state, but add it immediately for responsiveness
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
      setNewCommentText("");
      setActiveLineThread(null);
      setShowGeneralForm(false);
    },
    [sessionId]
  );

  const replyToThread = useCallback(
    async (threadId: number) => {
      const text = replyTexts[threadId];
      if (!text?.trim()) return;
      await fetch(`/session/${sessionId}/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setReplyTexts((prev) => ({ ...prev, [threadId]: "" }));
    },
    [sessionId, replyTexts]
  );

  const toggleThread = (id: number) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group threads by line
  const lineThreads = new Map<number, Thread[]>();
  const generalThreads: Thread[] = [];
  for (const t of threads) {
    if (t.line != null) {
      const existing = lineThreads.get(t.line) ?? [];
      existing.push(t);
      lineThreads.set(t.line, existing);
    } else {
      generalThreads.push(t);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            Plan Review
          </h1>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-xs">
              {sessionId.slice(0, 8)}
            </Badge>
            <Button
              size="sm"
              onClick={async () => {
                await fetch(`/session/${sessionId}/done`, { method: "POST" });
                window.close();
              }}
            >
              Done Reviewing
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Plan with line gutter */}
        <section className="mb-12">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 border-b border-border">
              <span className="text-xs font-mono text-muted-foreground">
                plan.md
              </span>
            </div>
            <div className="font-mono text-sm leading-relaxed">
              {planLines.map((line, i) => {
                const lineNum = i + 1;
                const hasThread = lineThreads.has(lineNum);
                const isActive = activeLineThread === lineNum;

                return (
                  <div key={i}>
                    <div
                      className={`group flex border-b border-border/50 last:border-b-0 ${
                        hasThread
                          ? "bg-accent/30"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      {/* Line number gutter with + icon on hover */}
                      <button
                        className="w-12 shrink-0 text-right pr-3 py-1 text-muted-foreground/50 select-none border-r border-border/50 hover:bg-accent/50 transition-colors relative"
                        onClick={() => {
                          if (isActive) {
                            setActiveLineThread(null);
                          } else {
                            setActiveLineThread(lineNum);
                            setNewCommentText("");
                          }
                        }}
                        title={`Comment on line ${lineNum}`}
                      >
                        <span className="text-xs group-hover:hidden">{lineNum}</span>
                        <span className="text-xs hidden group-hover:inline text-primary font-bold">+</span>
                        {hasThread && (
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                        )}
                      </button>
                      {/* Line content with lightweight syntax highlighting */}
                      <pre className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                        <StyledLine text={line} />
                      </pre>
                    </div>

                    {/* Inline thread display for this line */}
                    {hasThread &&
                      lineThreads.get(lineNum)!.map((thread) => (
                        <ThreadView
                          key={thread.id}
                          thread={thread}
                          expanded={expandedThreads.has(thread.id)}
                          onToggle={() => toggleThread(thread.id)}
                          replyText={replyTexts[thread.id] ?? ""}
                          onReplyTextChange={(text) =>
                            setReplyTexts((prev) => ({
                              ...prev,
                              [thread.id]: text,
                            }))
                          }
                          onReply={() => replyToThread(thread.id)}
                          flashedMessages={flashedMessages}
                        />
                      ))}

                    {/* New comment form for this line */}
                    {isActive && (
                      <div className="border-t border-border bg-muted/20 px-4 py-3 ml-12">
                        <Textarea
                          value={newCommentText}
                          onChange={(e) => setNewCommentText(e.target.value)}
                          placeholder={`Comment on line ${lineNum}...`}
                          className="mb-2 bg-background font-sans text-sm min-h-[60px]"
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveLineThread(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              createThread(lineNum, newCommentText)
                            }
                            disabled={!newCommentText.trim()}
                          >
                            Comment
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* General comments */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              General Comments
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGeneralForm(!showGeneralForm)}
            >
              {showGeneralForm ? "Cancel" : "Add Comment"}
            </Button>
          </div>

          {showGeneralForm && (
            <div className="mb-4 rounded-lg border border-border p-4 bg-muted/20">
              <Textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="General comment on the plan..."
                className="mb-2 bg-background text-sm min-h-[80px]"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => createThread(null, newCommentText)}
                  disabled={!newCommentText.trim()}
                >
                  Comment
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (newCommentText.trim()) {
                      await createThread(null, newCommentText);
                    }
                    await fetch(`/session/${sessionId}/done`, { method: "POST" });
                    window.close();
                  }}
                >
                  {newCommentText.trim() ? "Reply & Done" : "Done Reviewing"}
                </Button>
              </div>
            </div>
          )}

          {generalThreads.length === 0 && !showGeneralForm && (
            <p className="text-sm text-muted-foreground italic">
              No general comments yet.
            </p>
          )}

          <div className="space-y-2">
            {generalThreads.map((thread) => (
              <ThreadView
                key={thread.id}
                thread={thread}
                expanded={expandedThreads.has(thread.id)}
                onToggle={() => toggleThread(thread.id)}
                replyText={replyTexts[thread.id] ?? ""}
                onReplyTextChange={(text) =>
                  setReplyTexts((prev) => ({ ...prev, [thread.id]: text }))
                }
                onReply={() => replyToThread(thread.id)}
                flashedMessages={flashedMessages}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/** Lightweight markdown-aware line rendering — keeps raw text feel but adds visual hierarchy */
function StyledLine({ text }: { text: string }) {
  if (!text) return <span>{"\u00A0"}</span>;

  // Headings: # through ####
  const headingMatch = text.match(/^(#{1,4})\s(.+)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const sizeClass = level === 1 ? "text-base" : level === 2 ? "text-[0.9375rem]" : "text-sm";
    return (
      <span className={`font-bold text-foreground ${sizeClass}`}>
        <span className="text-muted-foreground/40">{headingMatch[1]} </span>
        {headingMatch[2]}
      </span>
    );
  }

  // Code fence markers
  if (text.match(/^```/)) {
    return <span className="text-muted-foreground/60 italic">{text}</span>;
  }

  // Bullet / numbered list items
  if (text.match(/^\s*[-*]\s/)) {
    const idx = text.indexOf("- ") !== -1 ? text.indexOf("- ") : text.indexOf("* ");
    return (
      <span>
        <span className="text-muted-foreground/40">{text.slice(0, idx + 2)}</span>
        <InlineFormatted text={text.slice(idx + 2)} />
      </span>
    );
  }
  if (text.match(/^\s*\d+\.\s/)) {
    const idx = text.indexOf(". ") + 2;
    return (
      <span>
        <span className="text-muted-foreground/40">{text.slice(0, idx)}</span>
        <InlineFormatted text={text.slice(idx)} />
      </span>
    );
  }

  // Blockquote
  if (text.match(/^>\s/)) {
    return (
      <span className="text-muted-foreground italic">
        <span className="text-muted-foreground/40">{"> "}</span>
        {text.slice(2)}
      </span>
    );
  }

  // Regular line with inline formatting
  return <InlineFormatted text={text} />;
}

/** Renders inline markdown: **bold**, `code`, *italic* */
function InlineFormatted({ text }: { text: string }) {
  // Split on inline patterns, preserving delimiters
  const parts: React.ReactNode[] = [];
  // Match **bold**, `code`, *italic* (in that order to avoid conflicts)
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <span key={match.index} className="font-bold text-foreground">
          {token.slice(2, -2)}
        </span>
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <span key={match.index} className="text-foreground bg-muted px-1 rounded-sm">
          {token.slice(1, -1)}
        </span>
      );
    } else if (token.startsWith("*")) {
      parts.push(
        <span key={match.index} className="italic">
          {token.slice(1, -1)}
        </span>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span>{parts.length > 0 ? parts : text}</span>;
}

function ThreadView({
  thread,
  expanded,
  onToggle,
  replyText,
  onReplyTextChange,
  onReply,
  flashedMessages,
}: {
  thread: Thread;
  expanded: boolean;
  onToggle: () => void;
  replyText: string;
  onReplyTextChange: (text: string) => void;
  onReply: () => void;
  flashedMessages: Set<number>;
}) {
  const firstMessage = thread.messages[0];
  const replyCount = thread.messages.length - 1;

  return (
    <div className="border-t border-border bg-muted/10 ml-12">
      {/* Thread header — first message */}
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
