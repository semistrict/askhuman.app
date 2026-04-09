import { SessionDO } from "@/worker/session";
import { createCompactId } from "@/lib/compact-id";
import { msg } from "@/lib/agent-messages";
import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import type { Thread } from "@/worker/session";
import { buildDocFileFeedbackClipboardText, getDocReviewFile } from "@/lib/file-review";

export class DocReviewError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "DocReviewError";
    this.status = status;
  }
}

export function createSession(): string {
  return createCompactId();
}

export async function initSession(id: string): Promise<void> {
  const session = SessionDO.getInstance(id);
  await session.getContent(); // touch to ensure DO initializes
}

export async function submitPlan(
  sessionId: string,
  markdown: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("files");
  await session.setReviewMode("doc");
  await session.setDocReviewState("ready");
  await session.replaceFiles([{ path: "doc.md", content: markdown }]);
  const url = `${baseUrl}/s/${sessionId}`;
  const planPollUrl = `${baseUrl}/review/${sessionId}/poll`;
  return {
    sessionId,
    url,
    instructions: msg("plan_instructions", {
      URL: url,
      POLL_URL: planPollUrl,
      SESSION_ID: sessionId,
      BASE_URL: baseUrl,
      FILE_PATH: "doc.md",
    }),
  };
}

export function getPendingDocThreads(threads: Thread[]): Thread[] {
  return threads.filter((thread) => {
    const first = thread.messages[0];
    return !thread.outdated && thread.hunk_id == null && thread.file_path == null && first?.role === "human";
  });
}

export async function buildDocFeedbackClipboardText(
  sessionId: string,
  baseUrl: string
): Promise<string> {
  return buildDocFileFeedbackClipboardText(sessionId, baseUrl);
}

export async function requestDocRevision(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  const state = await session.getDocReviewState();
  if (state === "processing") {
    return {
      ok: true,
      state: "processing" as const,
      message: msg("doc_processing"),
    };
  }
  if (state === "complete") {
    return {
      ok: true,
      state: "complete" as const,
      message: msg("doc_review_complete"),
    };
  }

  if (
    !(await session.hasConnectedAgentKind("plan_poll")) &&
    !(await session.hasConnectedAgentKind("file_poll")) &&
    !(await session.hasConnectedAgentKind("review_poll"))
  ) {
    return {
      ok: false,
      state: "agent_not_polling" as const,
      message: msg("doc_agent_not_polling"),
      clipboardText: await buildDocFeedbackClipboardText(sessionId, baseUrl),
    };
  }

  await session.setDocReviewState("processing");
  await session.markDone();
  return {
    ok: true,
    state: "processing" as const,
    message: msg("doc_processing"),
  };
}

export async function pollDocReview(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  const result = await pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "review");
  const state = await session.getDocReviewState();
  const message =
    result.status === "done" && state === "complete"
      ? msg("doc_review_complete")
      : result.message;
  return {
    ...result,
    threads: getPendingDocThreads(result.threads),
    message,
  };
}

export async function updateDocReview(
  sessionId: string,
  markdown: string,
  response: string | null,
  baseUrl: string
) {
  if (!markdown.trim()) {
    throw new DocReviewError(msg("doc_update_missing_markdown"));
  }

  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    await session.resetDone();
  }
  await session.setContentType("files");
  await session.setReviewMode("doc");
  await session.setDocReviewState("ready");
  await session.markOutdatedDocThreads();
  const currentFile = await getDocReviewFile(sessionId);
  await session.replaceFiles([{ path: currentFile?.path ?? "doc.md", content: markdown }]);
  if (response && response.trim()) {
    await session.createAgentThread(response.trim());
  }
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("doc_updated"),
  };
}

export async function parsePlanUpdateRequest(request: Request): Promise<{
  markdown: string;
  response: string | null;
}> {
  const contentType = request.headers.get("content-type") || "";

  if (/\bapplication\/json\b/i.test(contentType)) {
    const body = (await request.json()) as { markdown?: string; response?: string | null };
    return {
      markdown: typeof body.markdown === "string" ? body.markdown : "",
      response: typeof body.response === "string" ? body.response : null,
    };
  }

  if (/\bmultipart\/form-data\b/i.test(contentType)) {
    const formData = await request.formData();
    const markdownVal = formData.get("markdown");
    const responseVal = formData.get("response");
    const markdown =
      typeof markdownVal === "string"
        ? markdownVal
        : markdownVal
          ? await markdownVal.text()
          : "";
    const response =
      typeof responseVal === "string"
        ? responseVal
        : responseVal
          ? await responseVal.text()
          : null;
    return { markdown, response };
  }

  return {
    markdown: await request.text(),
    response: null,
  };
}

export async function getComments(sessionId: string) {
  const session = SessionDO.getInstance(sessionId);
  const threads = await session.getThreads();
  const done = await session.isDone();
  return { threads, done };
}
