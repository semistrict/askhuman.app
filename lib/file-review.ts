import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export class FileReviewError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "FileReviewError";
    this.status = status;
  }
}

export async function createFileSession(
  sessionId: string,
  files: { path: string; content: string }[],
  baseUrl: string
) {
  if (files.length === 0) {
    throw new FileReviewError(msg("file_no_files"));
  }

  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("files");
  await session.replaceFiles(files);

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("file_created", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
      FILE_COUNT: files.length,
    }),
  };
}

export async function updateFileSession(
  sessionId: string,
  files: { path: string; content: string }[],
  baseUrl: string
) {
  if (files.length === 0) {
    throw new FileReviewError(msg("file_no_files"));
  }

  const session = SessionDO.getInstance(sessionId);

  if (await session.isDone()) {
    throw new FileReviewError(msg("file_already_done"), 409);
  }

  const currentPaths = new Set(files.map((f) => f.path));
  await session.markOutdatedFileThreads(currentPaths);
  await session.replaceFiles(files);
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("file_updated", { FILE_COUNT: files.length }),
  };
}

export async function pollFileReview(sessionId: string, baseUrl: string) {
  return pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "files");
}

const RESERVED_FIELDS = new Set(["sessionId"]);

export function parseFileFormData(formData: FormData): {
  files: { path: string; content: string }[];
  sessionId: string | null;
} {
  const sessionIdVal = formData.get("sessionId");
  const sessionId =
    typeof sessionIdVal === "string" && sessionIdVal.trim()
      ? sessionIdVal.trim()
      : null;

  const files: { path: string; content: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (RESERVED_FIELDS.has(key)) continue;
    const content = typeof value === "string" ? value : "";
    if (content) {
      files.push({ path: key, content });
    }
  }

  return { files, sessionId };
}
