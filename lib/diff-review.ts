import { SessionDO } from "@/worker/session";

const MAX_VIEW_LINES = 200;

export class ShowHunksValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ShowHunksValidationError";
  }
}

export interface ParsedHunk {
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  content: string;
}

export function parseDiffToHunks(diff: string): ParsedHunk[] {
  const lines = diff.split("\n");
  const hunks: ParsedHunk[] = [];
  let currentFile = "";
  let currentHunkLines: string[] = [];
  let currentHeader = "";
  let oldStart = 0;
  let oldCount = 0;
  let newStart = 0;
  let newCount = 0;

  function flushHunk() {
    if (currentHeader && currentHunkLines.length > 0) {
      hunks.push({
        filePath: currentFile,
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: currentHeader,
        content: currentHunkLines.join("\n"),
      });
    }
    currentHunkLines = [];
    currentHeader = "";
  }

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("diff --combined")) {
      flushHunk();
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = match ? match[2] : "";
      continue;
    }

    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("Binary files")
    ) {
      continue;
    }

    const hunkMatch = line.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/
    );
    if (hunkMatch) {
      flushHunk();
      oldStart = parseInt(hunkMatch[1]);
      oldCount = parseInt(hunkMatch[2] ?? "1");
      newStart = parseInt(hunkMatch[3]);
      newCount = parseInt(hunkMatch[4] ?? "1");
      currentHeader = line;
      continue;
    }

    if (currentHeader) {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "\\ No newline at end of file") {
        currentHunkLines.push(line);
      }
    }
  }

  flushHunk();
  return hunks;
}

function countRenderedHunkLines(content: string): number {
  if (!content) return 0;
  return content
    .split("\n")
    .filter((line) => line !== "\\ No newline at end of file").length;
}

function showHunksCurl(baseUrl: string, sessionId: string): string {
  return [
    `curl -X POST "${baseUrl}/diff/${sessionId}/view" \\`,
    "  -H 'Content-Type: application/json' \\",
    "  -H 'Accept: application/json' \\",
    `  --data-binary '{"hunkIds":[<id>],"description":"Explain these changes."}'`,
  ].join("\n");
}

export async function submitDiff(
  sessionId: string,
  diff: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("diff");
  const parsed = parseDiffToHunks(diff);
  const hunks = await session.storeHunks(parsed);
  return {
    sessionId,
    hunks,
    message:
      [
        "Diff stored.",
        "",
        "Next, choose one or more hunk IDs and create a review view with:",
        showHunksCurl(baseUrl, sessionId),
      ].join("\n"),
  };
}

export async function showHunks(
  sessionId: string,
  hunkIds: number[],
  description: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (hunkIds.length === 0) {
    throw new ShowHunksValidationError(
      "show_hunks requires at least one hunk ID."
    );
  }

  const hunks = await session.getHunksByIds(hunkIds);
  if (hunks.length !== hunkIds.length) {
    const found = new Set(hunks.map((hunk) => hunk.id));
    const missing = hunkIds.filter((id) => !found.has(id));
    throw new ShowHunksValidationError(
      `show_hunks rejected unknown hunk IDs: ${missing.join(", ")}.`
    );
  }

  const totalLines = hunks.reduce(
    (sum, hunk) => sum + countRenderedHunkLines(hunk.content),
    0
  );
  if (hunks.length > 1 && totalLines > MAX_VIEW_LINES) {
    throw new ShowHunksValidationError(
      `show_hunks rejected ${hunks.length} hunks totaling ${totalLines} lines. Views are limited to ${MAX_VIEW_LINES} lines unless a single hunk exceeds that on its own. Split this into smaller batches.`
    );
  }

  await session.setView(description, hunkIds);
  const url = `${baseUrl}/session/${sessionId}`;
  return {
    sessionId,
    url,
    message:
      [
        "View updated.",
        "",
        "Poll for comments with:",
        `curl -H 'Accept: application/json' "${baseUrl}/diff/${sessionId}/poll"`,
      ].join("\n"),
  };
}
