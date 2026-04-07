import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export class PlaygroundError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "PlaygroundError";
    this.status = status;
  }
}

export async function createPlayground(
  sessionId: string,
  html: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("playground");
  await session.setContent(html);

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("playground_created", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
    }),
  };
}

export async function updatePlayground(
  sessionId: string,
  html: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);

  if (await session.isDone()) {
    await session.resetDone();
  }

  await session.setContent(html);
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("playground_updated"),
  };
}

export async function pollPlayground(sessionId: string, baseUrl: string) {
  const result = await pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "playground");
  const session = SessionDO.getInstance(sessionId);
  const playgroundResult = await session.getResult();
  return { ...result, result: playgroundResult };
}

export function parsePlaygroundFormData(formData: FormData): {
  html: string;
  sessionId: string | null;
} {
  const htmlVal = formData.get("html");
  const html = typeof htmlVal === "string" ? htmlVal : "";

  const sessionIdVal = formData.get("sessionId");
  const sessionId =
    typeof sessionIdVal === "string" && sessionIdVal.trim()
      ? sessionIdVal.trim()
      : null;

  return { html, sessionId };
}
