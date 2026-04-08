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

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export interface ServerFile {
  path: string;
  content: string;
}

interface Props {
  sessionId: string;
  files: ServerFile[];
  initialThreads: Thread[];
  isDone: boolean;
}

export function FileReviewClient({
  sessionId,
  files,
  initialThreads,
  isDone: initialIsDone,
}: Props) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [selectedFile, setSelectedFile] = useState<string>(files[0]?.path ?? "");
  const [activeLineComment, setActiveLineComment] = useState<{ filePath: string; line: number } | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [panelCommentText, setPanelCommentText] = useState("");
  const [isDone, setIsDone] = useState(initialIsDone);
  const wsRef = useRef<WebSocket | null>(null);
  const [fileListWidth, setFileListWidth] = usePersistedWidth("file-review-file-list-width", 224);
  const [commentsWidth, setCommentsWidth] = usePersistedWidth("file-review-comments-width", 384);

  const filesByPath = useMemo(
    () => new Map(files.map((f) => [f.path, f])),
    [files]
  );

  const currentFile = filesByPath.get(selectedFile);
  const currentLines = useMemo(
    () => currentFile?.content.split("\n") ?? [],
    [currentFile]
  );
  const currentLanguage = useMemo(
    () => selectedFile ? detectLanguage(selectedFile) : null,
    [selectedFile]
  );

  // Thread counts per file
  const fileThreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of threads) {
      if (t.file_path && !t.outdated) {
        counts.set(t.file_path, (counts.get(t.file_path) ?? 0) + 1);
      }
    }
    return counts;
  }, [threads]);

  // Threads for current file, keyed by line
  const lineThreads = useMemo(() => {
    const map = new Map<number, Thread[]>();
    for (const t of threads) {
      if (t.file_path === selectedFile && t.line != null) {
        const existing = map.get(t.line) ?? [];
        existing.push(t);
        map.set(t.line, existing);
      }
    }
    return map;
  }, [threads, selectedFile]);

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

    return () => ws.close();
  }, [sessionId]);

  const createThread = useCallback(
    async (filePath: string | null, line: number | null, text: string) => {
      const res = await fetch(`/s/${sessionId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, line, text }),
      });
      const thread: Thread = await res.json();
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
      setNewCommentText("");
      setPanelCommentText("");
      setActiveLineComment(null);
    },
    [sessionId]
  );

  const navigateFile = (direction: -1 | 1) => {
    const idx = files.findIndex((f) => f.path === selectedFile);
    const next = idx + direction;
    if (next >= 0 && next < files.length) {
      setSelectedFile(files[next].path);
      setActiveLineComment(null);
    }
  };

  if (files.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <div className="text-lg font-mono text-foreground">Waiting for the agent to submit files...</div>
          <p className="text-sm text-muted-foreground">The agent has not submitted any files yet.</p>
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
            File Review
          </h1>
          <Badge variant="outline" className="font-mono text-xs">
            {sessionId.slice(0, 8)}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* File selector sidebar */}
        <aside className="shrink-0 border-r border-border flex flex-col" style={{ width: fileListWidth }}>
          <div className="px-3 py-2 border-b border-border">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Files
              <span className="ml-1.5 text-foreground">{files.length}</span>
            </h2>
          </div>
          <nav className="flex-1 overflow-y-auto py-1">
            {files.map((file) => {
              const isSelected = file.path === selectedFile;
              const threadCount = fileThreadCounts.get(file.path) ?? 0;
              return (
                <button
                  key={file.path}
                  className={`w-full text-left px-3 py-1.5 text-sm font-mono transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50 text-foreground/80"
                  }`}
                  onClick={() => {
                    setSelectedFile(file.path);
                    setActiveLineComment(null);
                  }}
                  title={file.path}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate flex-1 text-xs">{file.path}</span>
                    {threadCount > 0 && (
                      <span className="shrink-0 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                        {threadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-border p-2 flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              disabled={files.findIndex((f) => f.path === selectedFile) <= 0}
              onClick={() => navigateFile(-1)}
            >
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              disabled={files.findIndex((f) => f.path === selectedFile) >= files.length - 1}
              onClick={() => navigateFile(1)}
            >
              Next
            </Button>
          </div>
        </aside>

        <ResizeHandle side="left" onDrag={setFileListWidth} minWidth={120} />

        {/* File content */}
        <main className="flex-1 overflow-y-auto">
          {currentFile && (
            <div className="flex flex-col h-full">
              <div className="bg-muted/50 px-4 py-2 border-b border-border shrink-0">
                <span className="text-xs font-mono text-foreground">{currentFile.path}</span>
              </div>
              <div className="flex-1 overflow-y-auto font-mono text-sm leading-relaxed">
                {currentLines.map((line, i) => {
                  const lineNum = i + 1;
                  const hasThread = lineThreads.has(lineNum);
                  const isActive = activeLineComment?.filePath === selectedFile && activeLineComment?.line === lineNum;
                  const highlighted = highlightLine(line, currentLanguage);

                  return (
                    <div key={i} id={`line-${lineNum}`}>
                      <div
                        className={`group flex border-b border-border/30 last:border-b-0 ${
                          hasThread
                            ? "bg-accent/30"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <button
                          className="w-12 shrink-0 text-right pr-3 py-1 text-muted-foreground/50 select-none border-r border-border/50 hover:bg-accent/50 transition-colors relative"
                          onClick={() => {
                            if (isDone) return;
                            if (isActive) {
                              setActiveLineComment(null);
                            } else {
                              setActiveLineComment({ filePath: selectedFile, line: lineNum });
                              setNewCommentText("");
                            }
                          }}
                          title={isDone ? undefined : `Comment on line ${lineNum}`}
                        >
                          <span className="text-xs group-hover:hidden">{lineNum}</span>
                          <span className="text-xs hidden group-hover:inline text-primary font-bold">+</span>
                          {hasThread && (
                            <span className="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary group-hover:hidden" />
                          )}
                        </button>
                        {currentLanguage === "markdown" ? (
                          <pre className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words">
                            <MarkdownLine text={line} />
                          </pre>
                        ) : (
                          <pre
                            className="flex-1 px-4 py-1 overflow-x-auto whitespace-pre-wrap break-words"
                            dangerouslySetInnerHTML={{ __html: highlighted || "\u00A0" }}
                          />
                        )}
                      </div>

                      {hasThread && lineThreads.get(lineNum)!.map((thread) => (
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
                            placeholder={`Comment on ${basename(selectedFile)}:${lineNum}...`}
                            className="mb-2 bg-background font-sans text-sm min-h-[60px]"
                            autoFocus
                          />
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setActiveLineComment(null)}>Cancel</Button>
                            <Button
                              size="sm"
                              onClick={() => createThread(selectedFile, lineNum, newCommentText)}
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
          )}
        </main>

        <ResizeHandle side="right" onDrag={setCommentsWidth} minWidth={200} />

        {/* Comments panel */}
        <aside className="shrink-0 border-l border-border" style={{ width: commentsWidth }}>
          <CommentPanel
            threads={threads}
            sessionId={sessionId}
            onScrollToLine={(target) => {
              if (typeof target === "string" && filesByPath.has(target)) {
                setSelectedFile(target);
                setActiveLineComment(null);
              } else if (typeof target === "number") {
                const el = document.getElementById(`line-${target}`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
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
