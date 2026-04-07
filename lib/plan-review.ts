import { SessionDO } from "@/worker/session";
import { createCompactId } from "@/lib/compact-id";
import { msg } from "@/lib/agent-messages";

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
  await session.setContent(markdown);
  const url = `${baseUrl}/s/${sessionId}`;
  const planPollUrl = `${baseUrl}/plan/${sessionId}/poll`;
  const planReplyUrl = `${baseUrl}/plan/${sessionId}/reply`;
  return {
    sessionId,
    url,
    instructions: msg("plan_instructions", {
      URL: url,
      POLL_URL: planPollUrl,
      REPLY_URL: planReplyUrl,
    }),
  };
}

export async function getComments(sessionId: string) {
  const session = SessionDO.getInstance(sessionId);
  const threads = await session.getThreads();
  const done = await session.isDone();
  return { threads, done };
}
