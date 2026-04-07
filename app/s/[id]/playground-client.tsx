"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import { handleDebugSocketMessage, sendTabHello } from "@/lib/debug-tab-client";

interface Props {
  sessionId: string;
  html: string;
  initialThreads: Thread[];
  isDone: boolean;
}

export function PlaygroundClient({
  sessionId,
  html,
  initialThreads,
  isDone: initialIsDone,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [isDone, setIsDone] = useState(initialIsDone);
  const [panelCommentText, setPanelCommentText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("playground-comments-width", 384);

  // Listen for postMessage from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "askhuman:result") {
        const data = typeof event.data.data === "string"
          ? event.data.data
          : JSON.stringify(event.data.data);
        setResult(data);
        // Persist to server
        fetch(`/s/${sessionId}/result`, {
          method: "POST",
          body: data,
        });
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sessionId]);

  // WebSocket
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
      if (await handleDebugSocketMessage(ws, data)) return;
      if (data.type === "thread") {
        setThreads((prev) => {
          if (prev.some((t) => t.id === data.thread.id)) return prev;
          return [...prev, data.thread];
        });
      } else if (data.type === "view") {
        window.location.reload();
      }
    });

    return () => ws.close();
  }, [sessionId]);

  const createThread = useCallback(
    async (text: string) => {
      const res = await fetch(`/s/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const thread: Thread = await res.json();
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
      setPanelCommentText("");
    },
    [sessionId]
  );

  const sorted = [...threads].sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            Playground
          </h1>
          <Badge variant="outline" className="font-mono text-xs">
            {sessionId.slice(0, 8)}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Playground iframe */}
        <main className="flex-1 overflow-hidden">
          <iframe
            ref={iframeRef}
            srcDoc={html}
            sandbox="allow-scripts allow-forms"
            className="w-full h-full border-0 bg-background"
            title="Playground"
          />
        </main>

        <ResizeHandle side="right" onDrag={setCommentsWidth} minWidth={200} />

        {/* Comments + Done panel */}
        <aside className="shrink-0 border-l border-border flex flex-col" style={{ width: commentsWidth }}>
          <div className="border-b border-border p-4 shrink-0">
            {isDone ? (
              <p className="text-sm text-muted-foreground">Review submitted. Waiting for agent...</p>
            ) : (
              <>
                <Textarea
                  value={panelCommentText}
                  onChange={(e) => setPanelCommentText(e.target.value)}
                  placeholder="Comment..."
                  className="mb-2 bg-background text-sm min-h-[60px]"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => createThread(panelCommentText)}
                    disabled={!panelCommentText.trim()}
                  >
                    Comment
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={async () => {
                      if (panelCommentText.trim()) {
                        await createThread(panelCommentText);
                      }
                      fetch(`/s/${sessionId}/done`, { method: "POST" });
                      setIsDone(true);
                    }}
                  >
                    {panelCommentText.trim() ? "Comment & Done" : "Done"}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Result preview */}
          {result != null && (
            <div className="border-b border-border p-4 shrink-0">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Result
              </h3>
              <pre className="text-xs font-mono text-foreground/80 bg-muted/30 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                {result}
              </pre>
            </div>
          )}

          {/* Comments */}
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
              return (
                <div key={thread.id} className="rounded-md px-3 py-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      #{thread.id}
                    </span>
                  </div>
                  <p className="text-xs font-sans text-foreground/80">
                    {first.text}
                  </p>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
