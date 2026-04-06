"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Thread, Message } from "@/worker/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ThreadView } from "@/components/thread-view";
import { CommentPanel } from "@/components/comment-panel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  id: number;
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

interface Props {
  sessionId: string;
  hunks: ServerHunk[];
  description: string | null;
  initialThreads: Thread[];
}

export function DiffReviewClient({
  sessionId,
  hunks: initialHunks,
  description: initialDescription,
  initialThreads,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeComment, setActiveComment] = useState<{ hunkId: number; offset: number } | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [panelCommentText, setPanelCommentText] = useState("");
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [flashedMessages, setFlashedMessages] = useState<Set<number>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<number>>(new Set());
  const [hunks, setHunks] = useState(initialHunks);
  const [description, setDescription] = useState(initialDescription);
  const wsRef = useRef<WebSocket | null>(null);

  // Group hunks by file for rendering
  const fileGroups = useMemo(() => {
    const groups = new Map<string, ServerHunk[]>();
    for (const h of hunks) {
      const existing = groups.get(h.filePath) ?? [];
      existing.push(h);
      groups.set(h.filePath, existing);
    }
    return groups;
  }, [hunks]);

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
        setFlashedMessages((prev) => new Set(prev).add(msg.id));
        setTimeout(() => {
          setFlashedMessages((prev) => {
            const next = new Set(prev);
            next.delete(msg.id);
            return next;
          });
        }, 2000);
        setExpandedThreads((prev) => new Set(prev).add(msg.thread_id));
      } else if (data.type === "view") {
        // Agent updated the view — reload to get new hunks from server
        window.location.reload();
      }
    });

    return () => ws.close();
  }, [sessionId]);

  const createThread = useCallback(
    async (hunkId: number | null, line: number | null, text: string) => {
      const res = await fetch(`/session/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hunkId, line, text }),
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

  const toggleFile = (filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      const hash = hashStr(filePath);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const scrollToLine = useCallback((line: number) => {
    // line is hunkId for panel navigation — scroll to hunk
    const el = document.getElementById(`hunk-${line}`);
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
          <p className="text-sm text-muted-foreground">The agent is selecting which parts of the diff to review.</p>
          <Badge variant="outline" className="font-mono text-xs">{sessionId.slice(0, 8)}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
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
          {/* Agent description */}
          {description && (
            <div className="prose prose-sm mb-6 max-w-none rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
              >
                {description}
              </ReactMarkdown>
            </div>
          )}

          {/* Hunks grouped by file */}
          <section className="space-y-6">
            {Array.from(fileGroups.entries()).map(([filePath, fileHunks]) => {
              const language = detectLanguage(filePath);
              const collapsed = collapsedFiles.has(hashStr(filePath));

              return (
                <div key={filePath} className="rounded-lg border border-border overflow-hidden">
                  <button
                    className="w-full bg-muted/50 px-4 py-2 border-b border-border flex items-center gap-2 hover:bg-muted/70 transition-colors"
                    onClick={() => toggleFile(filePath)}
                  >
                    <span className="text-xs text-muted-foreground">
                      {collapsed ? "\u25B6" : "\u25BC"}
                    </span>
                    <span className="text-xs font-mono text-foreground">{filePath}</span>
                  </button>

                  {!collapsed && (
                    <div className="font-mono text-sm leading-relaxed">
                      {fileHunks.map((hunk) => {
                        const diffLines = parseHunkContent(hunk);
                        return (
                          <div key={hunk.id} id={`hunk-${hunk.id}`}>
                            <div className="bg-muted/30 px-4 py-1 text-xs text-muted-foreground border-b border-border/50 font-mono">
                              {hunk.header}
                            </div>
                            {diffLines.map((diffLine) => {
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
                                        if (isActive) {
                                          setActiveComment(null);
                                        } else {
                                          setActiveComment({ hunkId: hunk.id, offset: diffLine.offset });
                                          setNewCommentText("");
                                        }
                                      }}
                                      title="Comment on this line"
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
                                      expanded={expandedThreads.has(thread.id)}
                                      onToggle={() => toggleThread(thread.id)}
                                      replyText={replyTexts[thread.id] ?? ""}
                                      onReplyTextChange={(text) => setReplyTexts((prev) => ({ ...prev, [thread.id]: text }))}
                                      onReply={() => replyToThread(thread.id)}
                                      flashedMessages={flashedMessages}
                                      className="ml-36"
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
                                          onClick={() => createThread(hunk.id, diffLine.offset, newCommentText)}
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
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </main>

        <aside className="w-96 shrink-0 border-l border-border">
          <CommentPanel
            threads={threads}
            sessionId={sessionId}
            onScrollToLine={(hunkId) => {
              const el = document.getElementById(`hunk-${hunkId}`);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            newCommentText={panelCommentText}
            onNewCommentTextChange={setPanelCommentText}
            onCreateGeneralComment={(text) => createThread(null, null, text)}
            onDone={async () => {
              await fetch(`/session/${sessionId}/done`, { method: "POST" });
              window.close();
            }}
            replyTexts={replyTexts}
            onReplyTextChange={(threadId, text) => setReplyTexts((prev) => ({ ...prev, [threadId]: text }))}
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

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
