import {
  createStableHunkId,
  parseAndValidateDiff,
  RequestHunksValidationError,
} from "@/lib/diff-matching";
import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export { RequestHunksValidationError } from "@/lib/diff-matching";

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
  const session = SessionDO.getInstance(sessionId);

  if (await session.isDone()) {
    throw new RequestHunksValidationError(msg("diff_already_done"), 409);
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
