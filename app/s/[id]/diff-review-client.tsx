"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Thread } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThreadView } from "@/components/thread-view";
import { CommentPanel } from "@/components/comment-panel";
import { MarkdownLine } from "@/components/markdown-line";
import { ResizeHandle, usePersistedWidth } from "@/components/resize-handle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { handleDebugSocketMessage, sendTabHello } from "@/lib/debug-tab-client";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import ruby from "highlight.js/lib/languages/ruby";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", java: "java",
  css: "css", scss: "css",
  json: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash", zsh: "bash",
  html: "xml", xml: "xml", svg: "xml",
  md: "markdown", sql: "sql", rb: "ruby",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  c: "c", h: "c",
  toml: "yaml",
};

function detectLanguage(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] ?? null : null;
}

function highlightLine(text: string, language: string | null): string {
  if (!language || !text.trim()) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language }).value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ServerHunk {
  id: string;
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  content: string;
}

interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
  oldNum: number | null;
  newNum: number | null;
  offset: number; // 1-based offset within hunk
}

function parseHunkContent(hunk: ServerHunk): DiffLine[] {
  const lines = hunk.content.split("\n");
  const result: DiffLine[] = [];
  let oldNum = hunk.oldStart;
  let newNum = hunk.newStart;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "\\ No newline at end of file") continue;
    const offset = i + 1;

    if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), oldNum: null, newNum: newNum++, offset });
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", text: line.slice(1), oldNum: oldNum++, newNum: null, offset });
    } else if (line.startsWith(" ")) {
      result.push({ type: "context", text: line.slice(1), oldNum: oldNum++, newNum: newNum++, offset });
    }
  }
  return result;
}

function isAdditionsOnlyHunk(lines: DiffLine[]): boolean {
  return lines.length > 0 && lines.every((line) => line.type === "add");
}

interface Props {
  sessionId: string;
  description: string | null;
  hunks: ServerHunk[];
  initialThreads: Thread[];
  isDone: boolean;
}

export function DiffReviewClient({
  sessionId,
  description,
  hunks,
  initialThreads,
  isDone: initialIsDone,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeComment, setActiveComment] = useState<{ hunkId: string; offset: number } | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [panelCommentText, setPanelCommentText] = useState("");
  const [isDone, setIsDone] = useState(initialIsDone);
  const wsRef = useRef<WebSocket | null>(null);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("diff-review-comments-width", 384);

  // Group hunks by file
  const fileGroups = useMemo(() => {
    const groups: { filePath: string; hunks: ServerHunk[] }[] = [];
    const seen = new Map<string, number>();
    for (const hunk of hunks) {
      const idx = seen.get(hunk.filePath);
      if (idx !== undefined) {
        groups[idx].hunks.push(hunk);
      } else {
        seen.set(hunk.filePath, groups.length);
        groups.push({ filePath: hunk.filePath, hunks: [hunk] });
      }
    }
    return groups;
  }, [hunks]);

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
        // Agent updated the diff — reload to get new hunks from server
        window.location.reload();
      }
    });

    return () => ws.close();
  }, [sessionId]);

  const createThread = useCallback(
    async (hunkId: string | null, line: number | null, text: string, filePath?: string | null) => {
      const res = await fetch(`/s/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hunkId, line, text, filePath }),
      });
      const thread: Thread = await res.json();
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
      setNewCommentText("");
      setPanelCommentText("");
      setActiveComment(null);
    },
    [sessionId]
  );

  const scrollToLine = useCallback((hunkId: string) => {
    const el = document.getElementById(`hunk-${hunkId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Build thread lookup: key = "hunkId:offset"
  const hunkThreads = new Map<string, Thread[]>();
  for (const t of threads) {
    if (t.hunk_id != null && t.line != null) {
      const key = `${t.hunk_id}:${t.line}`;
      const existing = hunkThreads.get(key) ?? [];
      existing.push(t);
      hunkThreads.set(key, existing);
    }
  }

  if (hunks.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <div className="text-lg font-mono text-foreground">Waiting for agent...</div>
          <p className="text-sm text-muted-foreground">The agent has not submitted a diff yet.</p>
          <Badge variant="outline" className="font-mono text-xs">{sessionId.slice(0, 8)}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight font-mono">
            Diff Review
          </h1>
          <Badge variant="outline" className="font-mono text-xs">
            {sessionId.slice(0, 8)}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <section className="space-y-6">
            {description && (
              <div className="prose prose-sm max-w-none rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {description}
                </ReactMarkdown>
              </div>
            )}

            {fileGroups.map((group) => (
              <div key={group.filePath} className="space-y-2">
                {group.hunks.map((hunk, hunkIdx) => {
                  const language = detectLanguage(hunk.filePath);
                  const diffLines = parseHunkContent(hunk);
                  const additionsOnly = isAdditionsOnlyHunk(diffLines);

                  return (
                    <div
                      key={`hunk-${hunk.id}-${hunkIdx}`}
                      id={`hunk-${hunk.id}`}
                      className="rounded-lg border border-border overflow-hidden"
                    >
                      <div className="bg-muted/50 px-4 py-2 border-b border-border">
                        <div className="text-xs font-mono text-foreground">{hunk.filePath}</div>
                      </div>
                      <div className="bg-muted/30 px-4 py-1 text-xs text-muted-foreground border-b border-border/50 font-mono">
                        {hunk.header}
                      </div>
                      <div className="font-mono text-sm leading-relaxed">
                        {additionsOnly ? (
                          language === "markdown" ? (
                            <AddedMarkdownHunk
                              hunk={hunk}
                              diffLines={diffLines}
                              hunkThreads={hunkThreads}
                              activeComment={activeComment}
                              onActivateComment={(offset) => {
                                if (isDone) return;
                                if (activeComment?.hunkId === hunk.id && activeComment.offset === offset) {
                                  setActiveComment(null);
                                } else {
                                  setActiveComment({ hunkId: hunk.id, offset });
                                  setNewCommentText("");
                                }
                              }}
                              newCommentText={newCommentText}
                              onNewCommentTextChange={setNewCommentText}
                              onCancelComment={() => setActiveComment(null)}
                              onCreateThread={createThread}
                            />
                          ) : (
                            <AddedSourceHunk
                              hunk={hunk}
                              diffLines={diffLines}
                              language={language}
                              hunkThreads={hunkThreads}
                              activeComment={activeComment}
                              onActivateComment={(offset) => {
                                if (isDone) return;
                                if (activeComment?.hunkId === hunk.id && activeComment.offset === offset) {
                                  setActiveComment(null);
                                } else {
                                  setActiveComment({ hunkId: hunk.id, offset });
                                  setNewCommentText("");
                                }
                              }}
                              newCommentText={newCommentText}
                              onNewCommentTextChange={setNewCommentText}
                              onCancelComment={() => setActiveComment(null)}
                              onCreateThread={createThread}
                            />
                          )
                        ) : (
                          diffLines.map((diffLine) => {
                            const threadKey = `${hunk.id}:${diffLine.offset}`;
                            const hasThread = hunkThreads.has(threadKey);
                            const isActive = activeComment?.hunkId === hunk.id && activeComment?.offset === diffLine.offset;
                            const bgClass = diffLine.type === "add" ? "bg-green-500/10" : diffLine.type === "remove" ? "bg-red-500/10" : "";
                            const highlighted = highlightLine(diffLine.text, language);

                            return (
                              <div key={`${hunk.id}-${diffLine.offset}`} id={`line-${hunk.id}-${diffLine.offset}`}>
                                <div className={`group flex border-b border-border/30 last:border-b-0 ${bgClass} ${hasThread ? "ring-1 ring-inset ring-primary/20" : ""}`}>
                                  <span className="w-12 shrink-0 text-right pr-2 py-1 text-muted-foreground/40 text-xs select-none border-r border-border/30">
                                    {diffLine.oldNum ?? ""}
                                  </span>
                                  <span className="w-12 shrink-0 text-right pr-2 py-1 text-muted-foreground/40 text-xs select-none border-r border-border/30">
                                    {diffLine.newNum ?? ""}
                                  </span>
                                  <span className={`w-6 shrink-0 text-center py-1 select-none ${diffLine.type === "add" ? "text-green-500" : diffLine.type === "remove" ? "text-red-500" : "text-transparent"}`}>
                                    {diffLine.type === "add" ? "+" : diffLine.type === "remove" ? "-" : " "}
                                  </span>
                                  <button
                                    className="w-6 shrink-0 py-1 text-center select-none opacity-0 group-hover:opacity-100 transition-opacity text-primary font-bold text-xs"
                                    onClick={() => {
                                      if (isDone) return;
                                      if (isActive) {
                                        setActiveComment(null);
                                      } else {
                                        setActiveComment({ hunkId: hunk.id, offset: diffLine.offset });
                                        setNewCommentText("");
                                      }
                                    }}
                                    title={isDone ? undefined : "Comment on this line"}
                                  >
                                    +
                                  </button>
                                  <pre className="flex-1 px-2 py-1 overflow-x-auto whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: highlighted || "\u00A0" }} />
                                  {hasThread && <span className="w-2 shrink-0 bg-primary/30" />}
                                </div>

                                {hasThread && hunkThreads.get(threadKey)!.map((thread) => (
                                  <ThreadView
                                    key={thread.id}
                                    thread={thread}
                                    commentNumber={thread.id}
                                    className="ml-36"
                                    outdated={thread.outdated}
                                  />
                                ))}

                                {isActive && (
                                  <div className="border-t border-border bg-muted/20 px-4 py-3 ml-36">
                                    <Textarea
                                      value={newCommentText}
                                      onChange={(e) => setNewCommentText(e.target.value)}
                                      placeholder="Comment on this line..."
                                      className="mb-2 bg-background font-sans text-sm min-h-[60px]"
                                      autoFocus
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <Button variant="ghost" size="sm" onClick={() => setActiveComment(null)}>Cancel</Button>
                                      <Button
                                        size="sm"
                                        onClick={() => createThread(hunk.id, diffLine.offset, newCommentText, hunk.filePath)}
                                        disabled={!newCommentText.trim()}
                                      >
                                        Comment
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        </main>

        <ResizeHandle side="right" onDrag={setCommentsWidth} minWidth={200} />

        <aside className="shrink-0 border-l border-border" style={{ width: commentsWidth }}>
          <CommentPanel
            threads={threads}
            sessionId={sessionId}
            onScrollToLine={(target) => {
              if (typeof target !== "string") return;
              scrollToLine(target);
            }}
            newCommentText={panelCommentText}
            onNewCommentTextChange={setPanelCommentText}
            onCreateGeneralComment={(text) => createThread(null, null, text)}
            onDone={() => {
              fetch(`/s/${sessionId}/done`, { method: "POST" });
              setIsDone(true);
            }}
            isDone={isDone}
          />
        </aside>
      </div>
    </div>
  );
}

type HunkThreadsMap = Map<string, Thread[]>;

interface AddedHunkProps {
  hunk: ServerHunk;
  diffLines: DiffLine[];
  hunkThreads: HunkThreadsMap;
  activeComment: { hunkId: string; offset: number } | null;
  onActivateComment: (offset: number) => void;
  newCommentText: string;
  onNewCommentTextChange: (text: string) => void;
  onCancelComment: () => void;
  onCreateThread: (hunkId: string | null, line: number | null, text: string, filePath?: string | null) => Promise<void>;
}

function AddedMarkdownHunk({
  hunk,
  diffLines,
  hunkThreads,
  activeComment,
  onActivateComment,
  newCommentText,
  onNewCommentTextChange,
  onCancelComment,
  onCreateThread,
}: AddedHunkProps) {
  return (
    <div data-hunk-rendering="markdown-additions">
      {diffLines.map((diffLine) => {
        const threadKey = `${hunk.id}:${diffLine.offset}`;
        const hasThread = hunkThreads.has(threadKey);
        const isActive = activeComment?.hunkId === hunk.id && activeComment.offset === diffLine.offset;

        return (
          <div key={`${hunk.id}-${diffLine.offset}`} id={`line-${hunk.id}-${diffLine.offset}`}>
            <div
              className={`group flex border-b border-border/50 last:border-b-0 ${
                hasThread ? "bg-accent/30" : "hover:bg-muted/30"
              }`}
            >
              <button
                className="w-12 shrink-0 text-right pr-3 py-1 text-muted-foreground/50 select-none border-r border-border/50 hover:bg-accent/50 transition-colors relative"
                onClick={() => onActivateComment(diffLine.offset)}
                title={`Comment on line ${diffLine.newNum ?? diffLine.offset}`}
              >
                <span className="text-xs group-hover:hidden">{diffLine.newNum ?? ""}</span>
                <span className="text-xs hidden group-hover:inline text-primary font-bold">+</span>
                {hasThread && (
                  <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                )}
              </button>
              <pre className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                <MarkdownLine text={diffLine.text} />
              </pre>
            </div>

            {hasThread && hunkThreads.get(threadKey)!.map((thread) => (
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
                  onChange={(e) => onNewCommentTextChange(e.target.value)}
                  placeholder={`Comment on line ${diffLine.newNum ?? diffLine.offset}...`}
                  className="mb-2 bg-background font-sans text-sm min-h-[60px]"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={onCancelComment}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={() => onCreateThread(hunk.id, diffLine.offset, newCommentText, hunk.filePath)}
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
  );
}

function AddedSourceHunk({
  hunk,
  diffLines,
  language,
  hunkThreads,
  activeComment,
  onActivateComment,
  newCommentText,
  onNewCommentTextChange,
  onCancelComment,
  onCreateThread,
}: AddedHunkProps & { language: string | null }) {
  return (
    <div data-hunk-rendering="source-additions">
      {diffLines.map((diffLine) => {
        const threadKey = `${hunk.id}:${diffLine.offset}`;
        const hasThread = hunkThreads.has(threadKey);
        const isActive = activeComment?.hunkId === hunk.id && activeComment.offset === diffLine.offset;
        const highlighted = highlightLine(diffLine.text, language);

        return (
          <div key={`${hunk.id}-${diffLine.offset}`} id={`line-${hunk.id}-${diffLine.offset}`}>
            <div
              className={`group flex border-b border-border/30 last:border-b-0 ${
                hasThread ? "ring-1 ring-inset ring-primary/20 bg-accent/10" : ""
              }`}
            >
              <button
                className="w-12 shrink-0 text-right pr-3 py-1 text-muted-foreground/40 text-xs select-none border-r border-border/30 hover:bg-accent/50 transition-colors relative"
                onClick={() => onActivateComment(diffLine.offset)}
                title={`Comment on line ${diffLine.newNum ?? diffLine.offset}`}
              >
                <span className="group-hover:hidden">{diffLine.newNum ?? ""}</span>
                <span className="hidden group-hover:inline text-primary font-bold">+</span>
                {hasThread && (
                  <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                )}
              </button>
              <pre
                className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: highlighted || "\u00A0" }}
              />
            </div>

            {hasThread && hunkThreads.get(threadKey)!.map((thread) => (
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
                  onChange={(e) => onNewCommentTextChange(e.target.value)}
                  placeholder={`Comment on line ${diffLine.newNum ?? diffLine.offset}...`}
                  className="mb-2 bg-background font-sans text-sm min-h-[60px]"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={onCancelComment}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={() => onCreateThread(hunk.id, diffLine.offset, newCommentText, hunk.filePath)}
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
  );
}
