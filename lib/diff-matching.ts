import { createHash } from "node:crypto";
import { msg } from "@/lib/agent-messages";

export class RequestHunksValidationError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "RequestHunksValidationError";
    this.status = status;
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

export function createStableHunkId(hunk: ParsedHunk): string {
  return createHash("md5")
    .update(`${hunk.filePath}\n${hunk.content}`)
    .digest("base64url");
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
      if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "\\ No newline at end of file"
      ) {
        currentHunkLines.push(line);
      }
    }
  }

  flushHunk();
  return hunks;
}

export function parseAndValidateDiff(diff: string): ParsedHunk[] {
  if (diff.trim() === "") {
    throw new RequestHunksValidationError(msg("match_empty_diff"));
  }

  const parsed = parseDiffToHunks(diff);
  if (parsed.length === 0) {
    throw new RequestHunksValidationError(msg("match_no_hunks"));
  }

  return parsed;
}
