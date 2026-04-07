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

export type MatchableHunk = ParsedHunk & {
  id: string;
  matchText: string;
};

export type ResolvedViewSection =
  | { type: "markdown"; markdown: string }
  | { type: "hunk"; hunkId: string };

type TemplateSection =
  | { type: "markdown"; markdown: string }
  | { type: "patch"; raw: string; info: string };

export function createStableHunkId(hunk: ParsedHunk): string {
  return createHash("md5")
    .update(`${hunk.filePath}\n${hunk.content}`)
    .digest("base64url");
}

function canonicalHunkText(hunk: ParsedHunk): string {
  return [`File: ${hunk.filePath}`, hunk.header, hunk.content].join("\n");
}

export function canonicalHeader(header: string): string {
  const trimmed = header.trim();
  const match = trimmed.match(/^(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@)/);
  return match ? match[1] : trimmed;
}

function normalizePatchBlock(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\.\.\.\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function parseTemplateSections(description: string): TemplateSection[] {
  const normalized = description.replace(/\r\n/g, "\n");
  const sections: TemplateSection[] = [];
  const re = /```patch([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(normalized)) !== null) {
    const markdown = normalized.slice(lastIndex, match.index);
    if (markdown) {
      sections.push({ type: "markdown", markdown });
    }
    sections.push({
      type: "patch",
      info: (match[1] ?? "").trim(),
      raw: match[2] ?? "",
    });
    lastIndex = match.index + match[0].length;
  }

  const trailing = normalized.slice(lastIndex);
  if (trailing) {
    sections.push({ type: "markdown", markdown: trailing });
  }

  return sections;
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

export function countRenderedHunkLines(content: string): number {
  if (!content) return 0;
  return content
    .split("\n")
    .filter((line) => line !== "\\ No newline at end of file").length;
}

function enrichHunks(hunks: ParsedHunk[]): MatchableHunk[] {
  return hunks.map((hunk) => ({
    ...hunk,
    id: createStableHunkId(hunk),
    matchText: canonicalHunkText(hunk),
  }));
}

function parsePatchInfo(info: string): { filePath?: string; header?: string } {
  const trimmed = info.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("@@")) {
    return { header: canonicalHeader(trimmed) };
  }

  const headerIndex = trimmed.indexOf("@@");
  if (headerIndex !== -1) {
    return {
      filePath: trimmed.slice(0, headerIndex).trim(),
      header: canonicalHeader(trimmed.slice(headerIndex).trim()),
    };
  }

  return { filePath: trimmed };
}

function containsDiffFileHeaders(raw: string): boolean {
  return /^(diff --git|index |--- |\+\+\+ )/m.test(raw.trim());
}

function previewPatchLines(content: string): string[] {
  const lines = content
    .split("\n")
    .filter((line) => line !== "\\ No newline at end of file");
  if (lines.length <= 4) return lines;
  return [
    lines[0],
    lines[1],
    "...",
    lines[lines.length - 2],
    lines[lines.length - 1],
  ];
}

function renderSuggestedPatchFence(hunk: MatchableHunk): string {
  const body = previewPatchLines(hunk.content).join("\n");
  return [`\`\`\`patch ${hunk.filePath} ${canonicalHeader(hunk.header)}`, body, "```"].join(
    "\n"
  );
}

function patchSearchTerms(
  info: { filePath?: string; header?: string },
  raw: string
): string[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  const plusPlusPath = normalized.match(/^\+\+\+ b\/(.+)$/m)?.[1];
  const diffGitPath = normalized.match(/^diff --git a\/(.+) b\/(.+)$/m)?.[2];
  const rawHeader = normalized.match(/^@@.*$/m)?.[0];
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "...");
  return [
    info.filePath,
    info.header,
    plusPlusPath,
    diffGitPath,
    rawHeader ? canonicalHeader(rawHeader) : undefined,
    ...lines,
  ].filter((value): value is string => Boolean(value));
}

function isDocumentationPath(filePath: string): boolean {
  return (
    /(^|\/)(README|CHANGELOG|LICENSE|CONTRIBUTING)(\.|$)/i.test(filePath) ||
    /\.(md|mdx|txt|rst|adoc)$/i.test(filePath)
  );
}

function hunkSimilarityScore(hunk: MatchableHunk, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (term === hunk.filePath) {
      score += 20;
      continue;
    }
    if (term === canonicalHeader(hunk.header)) {
      score += 15;
      continue;
    }
    if (hunk.matchText.includes(term)) {
      score += Math.min(term.length, 12);
    }
  }
  if (!isDocumentationPath(hunk.filePath)) {
    score += 2;
  }
  return score;
}

function nearestMatchingHunks(
  hunks: MatchableHunk[],
  info: { filePath?: string; header?: string },
  raw: string,
  limit: number = 3
): MatchableHunk[] {
  const terms = patchSearchTerms(info, raw);
  if (terms.length === 0) return [];
  return [...hunks]
    .map((hunk) => ({ hunk, score: hunkSimilarityScore(hunk, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.hunk);
}

function noMatchMessage(
  raw: string,
  info: { filePath?: string; header?: string },
  suggestions: MatchableHunk[]
): string {
  const lines = [
    containsDiffFileHeaders(raw)
      ? msg("match_no_match_with_headers")
      : msg("match_no_match_generic"),
  ];

  if (info.filePath || info.header) {
    lines.push("", "Parsed patch hints:");
    if (info.filePath) lines.push(`file: ${info.filePath}`);
    if (info.header) lines.push(`header: ${info.header}`);
  }

  if (suggestions.length > 0) {
    lines.push("", "Closest matching hunks you could submit:");
    for (const suggestion of suggestions) {
      lines.push("", renderSuggestedPatchFence(suggestion));
    }
  }

  return lines.join("\n");
}

function ambiguousMatchMessage(matches: MatchableHunk[]): string {
  const lines = [
    msg("match_ambiguous", { COUNT: matches.length }),
    "",
    "Matching hunks:",
  ];
  for (const match of matches.slice(0, 3)) {
    lines.push("", renderSuggestedPatchFence(match));
  }
  return lines.join("\n");
}

function resolvePatchSections(
  description: string,
  hunks: MatchableHunk[]
): { sections: ResolvedViewSection[]; selectedHunks: MatchableHunk[] } {
  const templateSections = parseTemplateSections(description);
  const sections: ResolvedViewSection[] = [];
  const selectedHunks: MatchableHunk[] = [];

  for (const section of templateSections) {
    if (section.type === "markdown") {
      sections.push(section);
      continue;
    }

    const info = parsePatchInfo(section.info);
    const chunks = normalizePatchBlock(section.raw);
    if (chunks.length === 0 && !info.filePath && !info.header) {
      throw new RequestHunksValidationError(msg("match_empty_patch"));
    }

    const candidateHunks = hunks.filter((hunk) => {
      if (info.filePath && hunk.filePath !== info.filePath) return false;
      if (info.header && canonicalHeader(hunk.header) !== info.header) return false;
      return true;
    });

    const matches = candidateHunks.filter((hunk) => {
      let start = 0;
      for (const chunk of chunks) {
        const idx = hunk.matchText.indexOf(chunk, start);
        if (idx === -1) return false;
        start = idx + chunk.length;
      }
      return true;
    });

    if (matches.length === 0) {
      throw new RequestHunksValidationError(
        noMatchMessage(section.raw, info, nearestMatchingHunks(hunks, info, section.raw))
      );
    }

    if (matches.length > 1) {
      throw new RequestHunksValidationError(ambiguousMatchMessage(matches));
    }

    sections.push({ type: "hunk", hunkId: matches[0].id });
    selectedHunks.push(matches[0]);
  }

  if (selectedHunks.length === 0) {
    throw new RequestHunksValidationError(msg("match_no_patch_blocks"));
  }

  return { sections, selectedHunks };
}

export function prepareDiffReviewRequest(description: string, diff: string) {
  const parsed = parseAndValidateDiff(diff);
  const hunks = enrichHunks(parsed);
  const { sections, selectedHunks } = resolvePatchSections(description, hunks);
  return { parsed, hunks, sections, selectedHunks };
}
