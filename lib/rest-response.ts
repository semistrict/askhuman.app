function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

export type ContentContext = Map<string, string[]>;

function getContextLines(
  context: ContentContext | undefined,
  thread: { file_path?: string | null; hunk_id?: string | null; line?: number | null }
): string | null {
  if (!context || thread.line == null) return null;
  const key = thread.file_path ?? thread.hunk_id ?? "__plan__";
  const lines = context.get(key);
  if (!lines) return null;
  const idx = thread.line - 1;
  const result: string[] = [];
  for (let i = idx - 1; i <= idx + 1; i++) {
    if (i < 0 || i >= lines.length) continue;
    const lineNum = i + 1;
    const prefix = i === idx ? " > " : "   ";
    result.push(`${prefix}${String(lineNum).padStart(4)}  ${lines[i]}`);
  }
  return result.length > 0 ? result.join("\n") : null;
}

function formatThread(
  thread: {
    id: number;
    hunk_id?: string | null;
    file_path?: string | null;
    line?: number | null;
    outdated?: boolean;
    messages: { role: string; text: string }[];
  },
  context?: ContentContext
): string {
  const location = thread.file_path
    ? `${thread.file_path}:${thread.line}`
    : thread.hunk_id != null && thread.line != null
      ? `H${thread.hunk_id}:${thread.line}`
      : thread.line != null
        ? `L${thread.line}`
        : "general";
  const outdatedTag = thread.outdated ? " [outdated]" : "";
  const lines = [`#${thread.id} (${location})${outdatedTag}`];
  const ctx = getContextLines(context, thread);
  if (ctx) {
    lines.push(ctx);
  }
  for (const message of thread.messages) {
    lines.push(`${message.role}: ${escapeMarkdown(message.text)}`);
  }
  return lines.join("\n");
}

export function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") || "";
  return /\bapplication\/json\b/i.test(accept);
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function negotiatedResponse(
  request: Request,
  json: unknown,
  markdown: string,
  init?: ResponseInit
): Response {
  if (wantsJson(request)) {
    return Response.json(json, init);
  }

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  return new Response(withTrailingNewline(markdown), { ...init, headers });
}

export function errorMarkdown(message: string, details?: unknown): string {
  const sections = [`# Error`, "", message];
  if (details !== undefined) {
    sections.push("", "## Details", "", JSON.stringify(details, null, 2));
  }
  return sections.join("\n");
}

export function planSubmitMarkdown(result: {
  sessionId: string;
  url: string;
  instructions: string;
}): string {
  return [
    "# Plan Review Session",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    "",
    "## Next Steps",
    "",
    result.instructions,
  ].join("\n");
}

export function diffSubmitMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# Diff Review Session",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", "## Next Steps", "", result.message] : []),
  ].join("\n");
}

export function diffUpdateMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# Diff Updated",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", result.message] : []),
  ].join("\n");
}

export function fileSubmitMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# File Review Session",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", "## Next Steps", "", result.message] : []),
  ].join("\n");
}

export function fileUpdateMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# Files Updated",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", result.message] : []),
  ].join("\n");
}

export function playgroundSubmitMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# Playground Session",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", "## Next Steps", "", result.message] : []),
  ].join("\n");
}

export function playgroundUpdateMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# Playground Updated",
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    ...(result.message ? ["", result.message] : []),
  ].join("\n");
}

export function playgroundPollMarkdown(result: {
  status: "comments" | "timeout" | "done" | "error";
  threads: { id: number; messages: { role: string; text: string }[] }[];
  result?: string | null;
  message?: string;
  next?: string;
}): string {
  return [
    `# ${result.status}`,
    ...(result.message ? ["", result.message] : []),
    ...(result.result != null ? ["", "## Result", "", result.result] : []),
    ...(result.threads.length
      ? ["", "## Comments", "", ...result.threads.map((t) => formatThread(t))]
      : []),
    ...(result.next ? ["", "## Next", "", result.next] : []),
  ].join("\n");
}

export function pollMarkdown(result: {
  status: "comments" | "timeout" | "done" | "error";
  threads: {
    id: number;
    hunk_id?: string | null;
    file_path?: string | null;
    line?: number | null;
    outdated?: boolean;
    messages: { role: string; text: string }[];
  }[];
  message?: string;
  next?: string;
  context?: ContentContext;
}): string {
  return [
    `# ${result.status}`,
    ...(result.message ? ["", result.message] : []),
    ...(result.threads.length
      ? ["", "## Comments", "", ...result.threads.map((t) => formatThread(t, result.context))]
      : []),
    ...(result.next ? ["", "## Next", "", result.next] : []),
  ].join("\n");
}

export function replyMarkdown(result: {
  sent: { thread_id: number; role: string; text: string }[];
  status: "comments" | "timeout" | "done" | "error";
  threads: {
    id: number;
    hunk_id?: string | null;
    line?: number | null;
    messages: { role: string; text: string }[];
  }[];
  message?: string;
  next?: string;
}): string {
  return [
    "# Replies Sent",
    "",
    "## Sent",
    "",
    ...result.sent.map(
      (message) =>
        `thread ${message.thread_id}: ${message.role}: ${escapeMarkdown(message.text)}`
    ),
    "",
    pollMarkdown({
      status: result.status,
      threads: result.threads,
      message: result.message,
      next: result.next,
    }),
  ].join("\n");
}

export function debugTabsMarkdown(result: {
  tabs: {
    tabId: string;
    sessionId: string;
    url: string | null;
    title: string | null;
    userAgent: string | null;
    connectedAt: number;
    lastSeenAt: number;
  }[];
}): string {
  return [
    "# Connected Tabs",
    "",
    `count: ${result.tabs.length}`,
    ...result.tabs.flatMap((tab) => [
      "",
      `## ${tab.tabId}`,
      `sessionId: ${tab.sessionId}`,
      `url: ${tab.url ?? ""}`,
      `title: ${tab.title ?? ""}`,
      `userAgent: ${tab.userAgent ?? ""}`,
      `connectedAt: ${new Date(tab.connectedAt).toISOString()}`,
      `lastSeenAt: ${new Date(tab.lastSeenAt).toISOString()}`,
    ]),
  ].join("\n");
}

export function debugEvalMarkdown(result: {
  tabId: string;
  sessionId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}): string {
  return [
    "# Debug Eval",
    "",
    `tabId: ${result.tabId}`,
    `sessionId: ${result.sessionId}`,
    `ok: ${result.ok}`,
    ...(result.result !== undefined
      ? ["", "## Result", "", typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2)]
      : []),
    ...(result.error ? ["", "## Error", "", result.error] : []),
  ].join("\n");
}

export function debugAgentsMarkdown(result: {
  agents: {
    agentId: string;
    sessionId: string;
    endpoint: string | null;
    kind: string;
    userAgent: string | null;
    connectedAt: number;
    lastSeenAt: number;
  }[];
}): string {
  return [
    "# Connected Agents",
    "",
    `count: ${result.agents.length}`,
    ...result.agents.flatMap((agent) => [
      "",
      `## ${agent.agentId}`,
      `sessionId: ${agent.sessionId}`,
      `endpoint: ${agent.endpoint ?? ""}`,
      `kind: ${agent.kind}`,
      `userAgent: ${agent.userAgent ?? ""}`,
      `connectedAt: ${new Date(agent.connectedAt).toISOString()}`,
      `lastSeenAt: ${new Date(agent.lastSeenAt).toISOString()}`,
    ]),
  ].join("\n");
}
