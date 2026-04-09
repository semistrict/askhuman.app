import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export class PresentError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "PresentError";
    this.status = status;
  }
}

export async function createPresentationSession(
  sessionId: string,
  markdown: string,
  baseUrl: string
) {
  if (!markdown.trim()) {
    throw new PresentError(msg("present_no_markdown"));
  }

  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("present");
  await session.setContent(markdown);

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("present_created", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
    }),
  };
}

export async function updatePresentationSession(
  sessionId: string,
  markdown: string,
  baseUrl: string
) {
  if (!markdown.trim()) {
    throw new PresentError(msg("present_no_markdown"));
  }

  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    await session.resetDone();
  }

  await session.setContentType("present");
  await session.markAllThreadsOutdated();
  await session.setContent(markdown);
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("present_updated"),
  };
}

export async function pollPresentation(sessionId: string, baseUrl: string) {
  return pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "present");
}

export async function parsePresentationRequest(request: Request): Promise<{
  markdown: string;
  sessionId: string | null;
}> {
  const contentType = request.headers.get("content-type") || "";

  if (/\bmultipart\/form-data\b/i.test(contentType)) {
    const formData = await request.formData();
    const markdownValue = formData.get("markdown");
    const sessionIdValue = formData.get("sessionId");
    const modeValue = formData.get("mode");
    const markdown =
      typeof markdownValue === "string"
        ? markdownValue
        : markdownValue
          ? await markdownValue.text()
          : "";
    const sessionId =
      typeof sessionIdValue === "string" && sessionIdValue.trim()
        ? sessionIdValue.trim()
        : null;
    if (typeof modeValue === "string" && modeValue.trim()) {
      throw new PresentError(msg("present_mode_removed"));
    }
    return { markdown, sessionId };
  }

  return {
    markdown: await request.text(),
    sessionId: null,
  };
}
