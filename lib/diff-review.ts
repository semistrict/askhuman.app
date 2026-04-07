import {
  createStableHunkId,
  parseAndValidateDiff,
  RequestHunksValidationError,
} from "@/lib/diff-matching";
import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export { RequestHunksValidationError } from "@/lib/diff-matching";

function validateDescription(description: string, diffLineCount: number): void {
  const lines = description.split("\n");
  const lineCount = lines.length;

  // Find headers and their positions
  const headers: { text: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      headers.push({ text: lines[i].replace(/^#+\s*/, "").trim(), line: i });
    }
  }

  // Must have reasonable header count (at least 1 per ~100 lines)
  const expectedHeaders = Math.max(1, Math.floor(lineCount / 100));
  if (headers.length < expectedHeaders) {
    throw new RequestHunksValidationError(
      msg("diff_description_no_headers", {
        HEADER_COUNT: headers.length,
        LINE_COUNT: lineCount,
      })
    );
  }

  // No section between headers should exceed 200 lines
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].line;
    const end = i + 1 < headers.length ? headers[i + 1].line : lines.length;
    const sectionLines = end - start;
    if (sectionLines > 200) {
      throw new RequestHunksValidationError(
        msg("diff_description_section_too_long", {
          SECTION: headers[i].text,
          SECTION_LINES: sectionLines,
        })
      );
    }
  }

  // Prose must be at least 15% of diff size, capped at 200 lines
  const proseLines = lines.filter(
    (l) => l.trim().length > 0 && !/^#{1,6}\s/.test(l) && !/^```/.test(l) && !/^---$/.test(l)
  ).length;
  const minProse = Math.min(200, Math.ceil(diffLineCount * 0.15));
  if (proseLines < minProse) {
    const percent = diffLineCount > 0 ? Math.round((proseLines / diffLineCount) * 100) : 0;
    throw new RequestHunksValidationError(
      msg("diff_description_too_little_prose", {
        PROSE_LINES: proseLines,
        DIFF_LINES: diffLineCount,
        PERCENT: percent,
      })
    );
  }
}

async function readFieldText(
  value: FormDataEntryValue | null,
  field: string
): Promise<string> {
  if (!value) {
    throw new RequestHunksValidationError(msg("form_missing_field", { FIELD: field }));
  }
  if (typeof value === "string") return value;
  return value.text();
}

export async function createDiffSession(
  sessionId: string,
  description: string,
  diff: string,
  baseUrl: string
) {
  const parsed = parseAndValidateDiff(diff);
  validateDescription(description, diff.split("\n").length);
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("diff");
  await session.setDescription(description);
  await session.replaceHunks(parsed);

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("diff_created", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
    }),
  };
}

export async function updateDiffSession(
  sessionId: string,
  description: string,
  diff: string,
  baseUrl: string
) {
  const parsed = parseAndValidateDiff(diff);
  validateDescription(description, diff.split("\n").length);
  const session = SessionDO.getInstance(sessionId);

  if (await session.isDone()) {
    await session.resetDone();
  }

  const newHunkIds = new Set(parsed.map((h) => createStableHunkId(h)));
  await session.markOutdatedThreads(newHunkIds);
  await session.setDescription(description);
  await session.replaceHunks(parsed);
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("diff_updated"),
  };
}

export async function pollDiffReview(sessionId: string, baseUrl: string) {
  return pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "diff");
}

export async function parseFormData(formData: FormData) {
  const description = await readFieldText(formData.get("description"), "description");
  const diff = await readFieldText(formData.get("diff"), "diff");
  const sessionId = formData.get("sessionId");
  return {
    description,
    diff,
    sessionId: typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null,
  };
}
