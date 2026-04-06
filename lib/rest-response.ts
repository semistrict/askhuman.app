function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

function fencedJson(value: unknown): string {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function formatThread(thread: {
  id: number;
  hunk_id?: number | null;
  line?: number | null;
  messages: { role: string; text: string }[];
}): string {
  const location =
    thread.hunk_id != null && thread.line != null
      ? `H${thread.hunk_id}:${thread.line}`
      : thread.line != null
        ? `L${thread.line}`
        : "general";
  const lines = [`- Thread ${thread.id} (${location})`];
  for (const message of thread.messages) {
    lines.push(`  - ${message.role}: ${escapeMarkdown(message.text)}`);
  }
  return lines.join("\n");
}

export function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") || "";
  return /\bapplication\/json\b/i.test(accept);
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
  return new Response(markdown, { ...init, headers });
}

export function errorMarkdown(message: string, details?: unknown): string {
  const sections = [`# Error`, "", message];
  if (details !== undefined) {
    sections.push("", fencedJson(details));
  }
  return sections.join("\n");
}

export function planSubmitMarkdown(result: {
  sessionId: string;
  url: string;
  instructions: string[];
}): string {
  return [
    "# Plan Review Session",
    "",
    `- **sessionId**: \`${result.sessionId}\``,
    `- **url**: ${result.url}`,
    "",
    "## Next Steps",
    "",
    ...result.instructions.map((line) => line.replace(/\n/g, "\n")),
  ].join("\n");
}

export function diffSubmitMarkdown(result: {
  sessionId: string;
  hunks: {
    id: number;
    file: string;
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    preview: { first: string; last: string };
  }[];
  message?: string;
}): string {
  return [
    "# Diff Review Session",
    "",
    `- **sessionId**: \`${result.sessionId}\``,
    `- **hunks**: ${result.hunks.length}`,
    "",
    "## Hunks",
    "",
    ...result.hunks.map((hunk) =>
      [
        `- **${hunk.id}** \`${hunk.file}\` \`-${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount}\``,
        hunk.preview.first
          ? `  - first: \`${escapeMarkdown(hunk.preview.first)}\``
          : "  - first: ` `",
        hunk.preview.last
          ? `  - last: \`${escapeMarkdown(hunk.preview.last)}\``
          : "  - last: ` `",
      ].join("\n")
    ),
    ...(result.message ? ["", "## Next Step", "", result.message] : []),
  ].join("\n");
}

export function viewUpdateMarkdown(result: {
  sessionId: string;
  url: string;
  message?: string;
}): string {
  return [
    "# View Updated",
    "",
    `- **sessionId**: \`${result.sessionId}\``,
    `- **url**: ${result.url}`,
    ...(result.message ? ["", result.message] : []),
  ].join("\n");
}

export function pollMarkdown(result: {
  status: "comments" | "timeout" | "done";
  threads: {
    id: number;
    hunk_id?: number | null;
    line?: number | null;
    messages: { role: string; text: string }[];
  }[];
  message?: string;
  next?: string;
}): string {
  return [
    `# ${result.status}`,
    ...(result.message ? ["", result.message] : []),
    ...(result.threads.length
      ? ["", "## Threads", "", ...result.threads.map(formatThread)]
      : []),
    ...(result.next ? ["", "## Next", "", "```bash", result.next, "```"] : []),
  ].join("\n");
}

export function replyMarkdown(result: {
  sent: { thread_id: number; role: string; text: string }[];
  status: "comments" | "timeout" | "done";
  threads: {
    id: number;
    hunk_id?: number | null;
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
        `- thread ${message.thread_id}: ${message.role}: ${escapeMarkdown(message.text)}`
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
