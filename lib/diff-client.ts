export type ClientParsedHunk = {
  id: string;
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  content: string;
};

function createClientStableHunkId(filePath: string, content: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const input = `${filePath}\n${content}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function parseDiffToClientHunks(diff: string): ClientParsedHunk[] {
  const lines = diff.split("\n");
  const hunks: ClientParsedHunk[] = [];
  let currentFile = "";
  let currentHunkLines: string[] = [];
  let currentHeader = "";
  let oldStart = 0;
  let oldCount = 0;
  let newStart = 0;
  let newCount = 0;

  function flushHunk() {
    if (currentHeader && currentHunkLines.length > 0) {
      const content = currentHunkLines.join("\n");
      hunks.push({
        id: createClientStableHunkId(currentFile, content),
        filePath: currentFile,
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: currentHeader,
        content,
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
      oldStart = Number.parseInt(hunkMatch[1], 10);
      oldCount = Number.parseInt(hunkMatch[2] ?? "1", 10);
      newStart = Number.parseInt(hunkMatch[3], 10);
      newCount = Number.parseInt(hunkMatch[4] ?? "1", 10);
      currentHeader = line;
      continue;
    }

    if (
      currentHeader &&
      (line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "\\ No newline at end of file")
    ) {
      currentHunkLines.push(line);
    }
  }

  flushHunk();
  return hunks;
}
