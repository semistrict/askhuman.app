"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Thread } from "@/worker/session";
import { SessionChrome } from "@/components/session-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnchoredCommentComposer } from "@/components/anchored-comment-composer";
import { CommentPanel } from "@/components/comment-panel";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import {
  bindReviewerPresenceSync,
  handleDebugSocketMessage,
  handlePresenceSocketMessage,
  sendTabHello,
} from "@/lib/debug-tab-client";

type SelectionDraft = {
  text: string;
  line: number | null;
  context: string;
  locationLabel: string;
  anchorTop: number;
  anchorLeft: number;
  rectTop: number;
  rectLeft: number;
  rectRight: number;
  rectBottom: number;
};

function updatePersistentSelectionHighlight(range: Range | null) {
  try {
    const css = (globalThis as typeof globalThis & {
      CSS?: { highlights?: Map<string, unknown> & { set: Function; delete: Function } };
    }).CSS;
    if (!css?.highlights || typeof Highlight === "undefined") {
      return;
    }
    if (!range) {
      css.highlights.delete("askhuman-selection");
      return;
    }
    css.highlights.set("askhuman-selection", new Highlight(range));
  } catch (error) {
    console.error("Failed to update persistent selection highlight", error);
  }
}

function splitSlides(markdown: string): string[] {
  return markdown
    .split(/\n\s*---\s*\n/g)
    .map((slide) => slide.trim())
    .filter(Boolean);
}

function getDeckTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "Slides";
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
  const deckTitle = useMemo(() => getDeckTitle(markdown), [markdown]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [isDone, setIsDone] = useState(initialIsDone);
  const [panelCommentText, setPanelCommentText] = useState("");
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [selectionCommentText, setSelectionCommentText] = useState("");
  const [selectionMenuVisible, setSelectionMenuVisible] = useState(false);
  const [selectionComposerOpen, setSelectionComposerOpen] = useState(false);
  const slideRef = useRef<HTMLDivElement | null>(null);
  const slideAreaRef = useRef<HTMLDivElement | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("present-comments-width", 384);

  const createThread = useCallback(
    async (
      text: string,
      metadata?: {
        line?: number | null;
        locationLabel?: string;
        selectionText?: string;
        selectionContext?: string;
        preserveSelection?: boolean;
      }
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
      if (metadata?.preserveSelection) {
        setSelectionCommentText("");
        setSelectionComposerOpen(false);
        setSelectionMenuVisible(false);
      } else {
        setSelectionCommentText("");
        setSelectionDraft(null);
        setSelectionMenuVisible(false);
        setSelectionComposerOpen(false);
        selectionRangeRef.current = null;
        updatePersistentSelectionHighlight(null);
        window.getSelection()?.removeAllRanges();
      }
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
      if (handlePresenceSocketMessage(data)) {
        return;
      }
      if (await handleDebugSocketMessage(ws, data)) {
        return;
      }
      if (data.type === "thread") {
        setThreads((prev) => (prev.some((t) => t.id === data.thread.id) ? prev : [...prev, data.thread]));
      } else if (data.type === "view") {
        window.location.reload();
      }
    });

    const cleanupPresenceSync = bindReviewerPresenceSync(ws);
    return () => {
      cleanupPresenceSync();
      ws.close();
    };
  }, [sessionId]);

  const captureSelection = useCallback(() => {
    if (isDone) return;
    const container = slideRef.current;
    const slideArea = slideAreaRef.current;
    if (!container || !slideArea) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      selectionRangeRef.current = null;
      updatePersistentSelectionHighlight(null);
      setSelectionDraft(null);
      setSelectionComposerOpen(false);
      setSelectionMenuVisible(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    const anchor =
      commonAncestor.nodeType === Node.ELEMENT_NODE
        ? (commonAncestor as Element)
        : commonAncestor.parentElement;
    if (!anchor || !container.contains(anchor)) {
      selectionRangeRef.current = null;
      updatePersistentSelectionHighlight(null);
      setSelectionDraft(null);
      setSelectionComposerOpen(false);
      setSelectionMenuVisible(false);
      return;
    }

    const text = compactWhitespace(selection.toString());
    if (!text) {
      selectionRangeRef.current = null;
      updatePersistentSelectionHighlight(null);
      setSelectionDraft(null);
      setSelectionComposerOpen(false);
      setSelectionMenuVisible(false);
      return;
    }

    const persistentRange = range.cloneRange();
    selectionRangeRef.current = persistentRange;
    updatePersistentSelectionHighlight(persistentRange);

    const slideMarkdown = slides[currentSlideIndex] ?? "";
    const line = approximateLineNumber(slideMarkdown, text);
    const locationLabel = line != null
      ? `slide ${currentSlideIndex + 1}, L${line}`
      : `slide ${currentSlideIndex + 1}`;
    const rangeRect = range.getBoundingClientRect();
    const areaRect = slideArea.getBoundingClientRect();
    const popoverWidth = Math.min(420, Math.max(280, slideArea.clientWidth - 32));
    const rawLeft = rangeRect.left - areaRect.left + slideArea.scrollLeft;
    const clampedLeft = Math.min(
      Math.max(slideArea.scrollLeft + 16, rawLeft),
      Math.max(slideArea.scrollLeft + 16, slideArea.scrollLeft + slideArea.clientWidth - popoverWidth - 16)
    );

    setSelectionDraft({
      text,
      context: getSelectionContext(container.innerText, text),
      line,
      locationLabel,
      anchorTop: rangeRect.bottom - areaRect.top + slideArea.scrollTop + 12,
      anchorLeft: clampedLeft,
      rectTop: rangeRect.top - areaRect.top + slideArea.scrollTop,
      rectLeft: rangeRect.left - areaRect.left + slideArea.scrollLeft,
      rectRight: rangeRect.right - areaRect.left + slideArea.scrollLeft,
      rectBottom: rangeRect.bottom - areaRect.top + slideArea.scrollTop,
    });
    setSelectionComposerOpen(false);
    setSelectionMenuVisible(false);
  }, [currentSlideIndex, isDone, slides]);

  useEffect(() => {
    setSelectionDraft(null);
    setSelectionCommentText("");
    setSelectionComposerOpen(false);
    setSelectionMenuVisible(false);
    selectionRangeRef.current = null;
    updatePersistentSelectionHighlight(null);
    window.getSelection()?.removeAllRanges();
  }, [currentSlideIndex]);

  useEffect(() => {
    return () => {
      updatePersistentSelectionHighlight(null);
    };
  }, []);

  const currentSlide = slides[currentSlideIndex] ?? "";
  const articleClassName = "prose prose-invert max-w-none text-[1.05rem] leading-8 selection:bg-amber-400/30";
  const slideSurfaceClassName = "mx-auto min-h-full max-w-5xl rounded-[28px] border border-border/70 bg-card/80 px-12 py-12 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm";

  return (
    <SessionChrome
      title={deckTitle}
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

            <div
              ref={slideAreaRef}
              className="relative flex-1 overflow-auto px-8 py-8"
              onMouseMove={(event) => {
                if (!selectionDraft || selectionComposerOpen) {
                  setSelectionMenuVisible(false);
                  return;
                }
                if (selectionMenuVisible) {
                  return;
                }
                const slideArea = slideAreaRef.current;
                if (!slideArea) return;
                const areaRect = slideArea.getBoundingClientRect();
                const x = event.clientX - areaRect.left + slideArea.scrollLeft;
                const y = event.clientY - areaRect.top + slideArea.scrollTop;
                const withinBounds =
                  x >= selectionDraft.rectLeft - 6 &&
                  x <= selectionDraft.rectRight + 6 &&
                  y >= selectionDraft.rectTop - 6 &&
                  y <= selectionDraft.rectBottom + 6;
                if (withinBounds) {
                  setSelectionMenuVisible(true);
                }
              }}
            >
              <div
                ref={slideRef}
                onMouseUp={captureSelection}
                onKeyUp={captureSelection}
                className={slideSurfaceClassName}
              >
                <div className="mb-8 flex items-center justify-end">
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

              {selectionDraft && !isDone && selectionMenuVisible && !selectionComposerOpen && (
                <div
                  className="pointer-events-auto absolute z-20"
                  style={{ top: selectionDraft.anchorTop, left: selectionDraft.anchorLeft }}
                >
                  <Button
                    data-testid="selection-comment-trigger"
                    size="sm"
                    variant="secondary"
                    className="shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
                    onClick={() => {
                      setSelectionComposerOpen(true);
                      setSelectionMenuVisible(false);
                    }}
                  >
                    Comment
                  </Button>
                </div>
              )}

              {selectionDraft && !isDone && selectionComposerOpen && (
                <AnchoredCommentComposer
                  className="pointer-events-auto absolute z-20 w-[min(420px,calc(100%-2rem))]"
                  style={{ top: selectionDraft.anchorTop, left: selectionDraft.anchorLeft }}
                  value={selectionCommentText}
                  onChange={setSelectionCommentText}
                  onClose={() => {
                    setSelectionComposerOpen(false);
                    setSelectionMenuVisible(false);
                  }}
                  onSubmit={() =>
                    createThread(selectionCommentText, {
                      line: selectionDraft.line,
                      locationLabel: selectionDraft.locationLabel,
                      selectionText: selectionDraft.text,
                      selectionContext: selectionDraft.context,
                      preserveSelection: true,
                    })
                  }
                  placeholder="Comment on this selection..."
                  submitLabel="Comment"
                  submitButtonTestId="selection-comment-submit"
                />
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
      <style>{`::highlight(askhuman-selection) { background: rgba(251, 191, 36, 0.28); }`}</style>
    </SessionChrome>
  );
}
