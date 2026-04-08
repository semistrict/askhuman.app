"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThreadView } from "@/components/thread-view";
import { CommentPanel } from "@/components/comment-panel";
import { MarkdownLine } from "@/components/markdown-line";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import { handleDebugSocketMessage, sendTabHello } from "@/lib/debug-tab-client";

interface Props {
  sessionId: string;
  planLines: string[];
  initialThreads: Thread[];
  isProcessing: boolean;
}

export function ReviewClient({
  sessionId,
  planLines,
  initialThreads,
  isProcessing: initialIsProcessing,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeLineThread, setActiveLineThread] = useState<number | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [panelCommentText, setPanelCommentText] = useState("");
  const [isProcessing, setIsProcessing] = useState(initialIsProcessing);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
      } else if (data.type === "view") {
        window.location.reload();
      }
    });

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const requestRevision = useCallback(async () => {
    const res = await fetch(`/s/${sessionId}/request-revision`, {
      method: "POST",
    });
    const body = (await res.json()) as {
      ok: boolean;
      state: "processing" | "agent_not_polling";
      message: string;
      clipboardText?: string;
    };

    if (body.state === "processing") {
      setIsProcessing(true);
      setStatusMessage(null);
      return;
    }

    let message = body.message;
    if (body.clipboardText) {
      try {
        await navigator.clipboard.writeText(body.clipboardText);
        message = `${body.message} Feedback copied to the clipboard.`;
      } catch {
        message = `${body.message} Clipboard copy failed; try again after starting the agent poll.`;
      }
    }
    setStatusMessage(message);
  }, [sessionId]);

  const copyFeedback = useCallback(async () => {
    const res = await fetch(`/s/${sessionId}/copy-feedback`, {
      method: "POST",
    });
    const body = (await res.json()) as {
      ok: boolean;
      clipboardText: string;
    };

    try {
      await navigator.clipboard.writeText(body.clipboardText);
      setStatusMessage("Feedback copied to the clipboard.");
    } catch {
      setStatusMessage("Clipboard copy failed. Copy the feedback manually from the agent instructions.");
    }
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
      setStatusMessage(null);
      setNewCommentText("");
      setPanelCommentText("");
      setActiveLineThread(null);
    },
    [sessionId]
  );

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
    <div className="h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            Doc Review
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
                  doc.md
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
                            if (isProcessing) return;
                            if (isActive) {
                              setActiveLineThread(null);
                            } else {
                              setActiveLineThread(lineNum);
                              setNewCommentText("");
                            }
                          }}
                          title={isProcessing ? undefined : `Comment on line ${lineNum}`}
                        >
                          <span className="text-xs group-hover:hidden">{lineNum}</span>
                          <span className="text-xs hidden group-hover:inline text-primary font-bold">+</span>
                          {hasThread && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                          )}
                        </button>
                        <pre className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                          <MarkdownLine text={line} />
                        </pre>
                      </div>

                      {hasThread &&
                        lineThreads.get(lineNum)!.map((thread) => (
                          <ThreadView
                            key={thread.id}
                            thread={thread}
                            commentNumber={thread.id}
                            className="ml-12"
                            outdated={thread.outdated}
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
            onDone={requestRevision}
            doneLabel="Request Revision"
            isDone={isProcessing}
            lockedMessage="Agent processing feedback..."
            lockedActionLabel="Copy Feedback Instead"
            onLockedAction={copyFeedback}
            statusMessage={statusMessage}
            statusTone="warning"
          />
        </aside>
      </div>
    </div>
  );
}
