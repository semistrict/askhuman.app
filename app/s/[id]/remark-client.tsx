"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Thread } from "@/worker/session";
import { SessionChrome } from "@/components/session-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CommentPanel } from "@/components/comment-panel";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import { handleDebugSocketMessage, sendTabHello } from "@/lib/debug-tab-client";

type SelectionDraft = {
  text: string;
  context: string;
  line: number | null;
  locationLabel: string;
};

function splitSlides(markdown: string): string[] {
  return markdown
    .split(/\n\s*---\s*\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getSelectionContext(containerText: string, selectionText: string): string {
  const normalizedContainer = compactWhitespace(containerText);
  const normalizedSelection = compactWhitespace(selectionText);
  if (!normalizedContainer || !normalizedSelection) return "";
  const index = normalizedContainer.indexOf(normalizedSelection);
  if (index === -1) return normalizedSelection;
  const before = normalizedContainer.slice(Math.max(0, index - 80), index).trim();
  const after = normalizedContainer
    .slice(index + normalizedSelection.length, index + normalizedSelection.length + 80)
    .trim();
  return [before && `...${before}`, `"${normalizedSelection}"`, after && `${after}...`]
    .filter(Boolean)
    .join(" ");
}

function approximateLineNumber(slideMarkdown: string, selectionText: string): number | null {
  const normalizedSelection = compactWhitespace(selectionText).toLowerCase();
  if (!normalizedSelection) return null;
  const probe = normalizedSelection.split(" ").slice(0, 6).join(" ");
  const lines = slideMarkdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = compactWhitespace(lines[index]).toLowerCase();
    if (!normalizedLine) continue;
    if (normalizedLine.includes(probe) || probe.includes(normalizedLine)) {
      return index + 1;
    }
  }
  return null;
}

interface Props {
  sessionId: string;
  markdown: string;
  initialThreads: Thread[];
  isDone: boolean;
}

export function PresentClient({
  sessionId,
  markdown,
  initialThreads,
  isDone: initialIsDone,
}: Props) {
  const slides = useMemo(() => splitSlides(markdown), [markdown]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [isDone, setIsDone] = useState(initialIsDone);
  const [panelCommentText, setPanelCommentText] = useState("");
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [selectionCommentText, setSelectionCommentText] = useState("");
  const slideRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("present-comments-width", 384);

  const createThread = useCallback(
    async (
      text: string,
      metadata?: { line?: number | null; locationLabel?: string; selectionText?: string; selectionContext?: string }
    ) => {
      const res = await fetch(`/s/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          filePath: metadata?.selectionText ? "slides.md" : null,
          line: metadata?.line ?? null,
          locationLabel: metadata?.locationLabel,
          selectionText: metadata?.selectionText,
          selectionContext: metadata?.selectionContext,
        }),
      });
      const thread: Thread = await res.json();
      setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [...prev, thread]));
      setPanelCommentText("");
      setSelectionCommentText("");
      setSelectionDraft(null);
      window.getSelection()?.removeAllRanges();
    },
    [sessionId]
  );

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
        setThreads((prev) => (prev.some((t) => t.id === data.thread.id) ? prev : [...prev, data.thread]));
      } else if (data.type === "view") {
        window.location.reload();
      }
    });

    return () => ws.close();
  }, [sessionId]);

  const captureSelection = useCallback(() => {
    if (isDone) return;
    const container = slideRef.current;
    if (!container) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setSelectionDraft(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    const anchor =
      commonAncestor.nodeType === Node.ELEMENT_NODE
        ? (commonAncestor as Element)
        : commonAncestor.parentElement;
    if (!anchor || !container.contains(anchor)) {
      setSelectionDraft(null);
      return;
    }

    const text = compactWhitespace(selection.toString());
    if (!text) {
      setSelectionDraft(null);
      return;
    }

    const slideMarkdown = slides[currentSlideIndex] ?? "";
    const line = approximateLineNumber(slideMarkdown, text);
    const locationLabel = line != null
      ? `slide ${currentSlideIndex + 1}, L${line}`
      : `slide ${currentSlideIndex + 1}`;

    setSelectionDraft({
      text,
      context: getSelectionContext(container.innerText, text),
      line,
      locationLabel,
    });
  }, [currentSlideIndex, isDone, slides]);

  useEffect(() => {
    setSelectionDraft(null);
    setSelectionCommentText("");
    window.getSelection()?.removeAllRanges();
  }, [currentSlideIndex]);

  const currentSlide = slides[currentSlideIndex] ?? "";
  const shellLabel = "remark markdown presentation";
  const articleClassName = "prose prose-invert max-w-none text-[1.05rem] leading-8 selection:bg-amber-400/30";
  const slideSurfaceClassName = "mx-auto min-h-full max-w-5xl rounded-[28px] border border-border/70 bg-card/80 px-12 py-12 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm";

  return (
    <SessionChrome
      title="Presentation"
      sessionId={sessionId}
      headerBadges={
        <>
          <Badge variant="outline" className="font-mono text-xs">
            Remark
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">
            slide {Math.min(currentSlideIndex + 1, slides.length)} / {slides.length}
          </Badge>
        </>
      }
    >
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_40%),linear-gradient(180deg,_rgba(255,255,255,0.02),_rgba(0,0,0,0))]">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-3">
              <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
                select text on the slide to leave an anchored comment
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentSlideIndex <= 0}
                  onClick={() => setCurrentSlideIndex((index) => Math.max(0, index - 1))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentSlideIndex >= slides.length - 1}
                  onClick={() => setCurrentSlideIndex((index) => Math.min(slides.length - 1, index + 1))}
                >
                  Next
                </Button>
              </div>
            </div>

            <div className="relative flex-1 overflow-auto px-8 py-8">
              <div
                ref={slideRef}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
                className={slideSurfaceClassName}
              >
                <div className="mb-8 flex items-center justify-between">
                  <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                    {shellLabel}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    slide {currentSlideIndex + 1}
                  </div>
                </div>

                <article className={articleClassName}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {currentSlide}
                  </ReactMarkdown>
                </article>
              </div>

              {selectionDraft && !isDone && (
                <div className="pointer-events-auto absolute inset-x-8 bottom-6 mx-auto max-w-3xl rounded-2xl border border-amber-500/30 bg-[#1d1810]/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200/70">
                        Anchored Comment
                      </div>
                      <div className="text-sm text-amber-50">{selectionDraft.locationLabel}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectionDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                  <div className="mb-3 rounded-xl border border-amber-500/20 bg-black/20 px-3 py-2 text-sm text-amber-50/90">
                    “{selectionDraft.text}”
                    {selectionDraft.context && (
                      <div className="mt-1 text-xs text-amber-100/60">{selectionDraft.context}</div>
                    )}
                  </div>
                  <Textarea
                    value={selectionCommentText}
                    onChange={(event) => setSelectionCommentText(event.target.value)}
                    placeholder="Comment on this selection..."
                    className="mb-3 min-h-[84px] border-amber-500/20 bg-black/20 text-sm"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectionDraft(null)}>
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        createThread(selectionCommentText, {
                          line: selectionDraft.line,
                          locationLabel: selectionDraft.locationLabel,
                          selectionText: selectionDraft.text,
                          selectionContext: selectionDraft.context,
                        })
                      }
                      disabled={!selectionCommentText.trim()}
                    >
                      Comment on Selection
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>

        <ResizeHandle side="right" onDrag={setCommentsWidth} minWidth={200} />

        <aside className="shrink-0 border-l border-border" style={{ width: commentsWidth }}>
          <CommentPanel
            threads={threads}
            sessionId={sessionId}
            onScrollToLine={() => undefined}
            newCommentText={panelCommentText}
            onNewCommentTextChange={setPanelCommentText}
            onCreateGeneralComment={(text) => createThread(text)}
            onDone={() => {
              fetch(`/s/${sessionId}/done`, { method: "POST" });
              setIsDone(true);
            }}
            isDone={isDone}
          />
        </aside>
      </div>
    </SessionChrome>
  );
}
