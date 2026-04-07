"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread, Message } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThreadView } from "@/components/thread-view";
import { CommentPanel } from "@/components/comment-panel";
import { PlanLine } from "@/components/plan-line";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import { handleDebugSocketMessage, sendTabHello } from "@/lib/debug-tab-client";

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
  const [newCommentText, setNewCommentText] = useState("");
  const [panelCommentText, setPanelCommentText] = useState("");
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [flashedMessages, setFlashedMessages] = useState<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("plan-review-comments-width", 384);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/s/${sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      sendTabHello(ws);
    });

    ws.addEventListener("message", async (event) => {
      const data = JSON.parse(event.data);
      if (await handleDebugSocketMessage(ws, data)) {
        return;
      }
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
        setFlashedMessages((prev) => new Set(prev).add(msg.id));
        setTimeout(() => {
          setFlashedMessages((prev) => {
            const next = new Set(prev);
            next.delete(msg.id);
            return next;
          });
        }, 2000);
        setExpandedThreads((prev) => new Set(prev).add(msg.thread_id));
      }
    });

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const createThread = useCallback(
    async (line: number | null, text: string) => {
      const res = await fetch(`/s/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line, text }),
      });
      const thread: Thread = await res.json();
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
      setNewCommentText("");
      setPanelCommentText("");
      setActiveLineThread(null);
    },
    [sessionId]
  );

  const replyToThread = useCallback(
    async (threadId: number) => {
      const text = replyTexts[threadId];
      if (!text?.trim()) return;
      await fetch(`/s/${sessionId}/threads/${threadId}/messages`, {
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

  const scrollToLine = useCallback((line: number) => {
    const el = document.getElementById(`line-${line}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Group threads by line
  const lineThreads = new Map<number, Thread[]>();
  for (const t of threads) {
    if (t.line != null) {
      const existing = lineThreads.get(t.line) ?? [];
      existing.push(t);
      lineThreads.set(t.line, existing);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            Plan Review
          </h1>
          <Badge variant="outline" className="font-mono text-xs">
            {sessionId.slice(0, 8)}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <section className="max-w-5xl">
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
                    <div key={i} id={`line-${lineNum}`}>
                      <div
                        className={`group flex border-b border-border/50 last:border-b-0 ${
                          hasThread
                            ? "bg-accent/30"
                            : "hover:bg-muted/30"
                        }`}
                      >
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
                        <pre className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                          <PlanLine text={line} />
                        </pre>
                      </div>

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
                            className="ml-12"
                          />
                        ))}

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
        </main>

        {/* Right side panel */}
        <ResizeHandle side="right" onDrag={setCommentsWidth} minWidth={200} />

        <aside className="shrink-0 border-l border-border" style={{ width: commentsWidth }}>
          <CommentPanel
            threads={threads}
            sessionId={sessionId}
            onScrollToLine={scrollToLine}
            newCommentText={panelCommentText}
            onNewCommentTextChange={setPanelCommentText}
            onCreateGeneralComment={(text) => createThread(null, text)}
            onDone={async () => {
              await fetch(`/s/${sessionId}/done`, { method: "POST" });
              window.close();
            }}
            replyTexts={replyTexts}
            onReplyTextChange={(threadId, text) =>
              setReplyTexts((prev) => ({ ...prev, [threadId]: text }))
            }
            onReply={(threadId) => replyToThread(threadId)}
            expandedThreads={expandedThreads}
            onToggleThread={toggleThread}
            flashedMessages={flashedMessages}
          />
        </aside>
      </div>
    </div>
  );
}
