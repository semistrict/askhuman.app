import { SessionDO, type Thread, type Message } from "@/worker/session";

export type { Thread, Message };
export const REST_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export function createSession(): string {
  return crypto.randomUUID();
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
  const url = `${baseUrl}/session/${sessionId}`;
  const pollUrl = `${baseUrl}/plan/${sessionId}/poll`;
  const replyUrl = `${baseUrl}/plan/${sessionId}/reply`;
  return {
    sessionId,
    url,
    instructions: [
      `1. Open the review page in the user's browser:\n   open "${url}"`,
      `2. Poll for human comments (long-polls up to 10 min, returns immediately when comments arrive):\n   curl -H 'Accept: application/json' ${pollUrl}`,
      `3. The response has a "status" field: "comments" (new feedback), "timeout" (no activity, poll again), or "done" (human finished reviewing).`,
      `4. When status is "comments", make any requested code changes first. Then reply to each thread and auto-poll for the next round. If no code changes are needed, reply immediately:\n   curl -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"replies":[{"threadId":1,"text":"your reply"}]}' ${replyUrl}`,
      `5. The reply response also has "status"/"threads" -- loop until status is "done".`,
    ],
  };
}

export function formatPollResponse(
  result: { threads: Thread[]; done?: boolean },
  sessionId: string,
  baseUrl: string,
  prefix: string = "plan"
) {
  const commentsUrl = `${baseUrl}/${prefix}/${sessionId}/poll`;
  const replyUrl = `${baseUrl}/${prefix}/${sessionId}/reply`;

  if (result.done) {
    return {
      status: "done" as const,
      threads: result.threads,
      message: "The human has finished reviewing. No further polling needed.",
    };
  }

  if (result.threads.length === 0) {
    return {
      status: "timeout" as const,
      threads: [] as Thread[],
      message: "No new comments yet. The human may still be reviewing. Poll again.",
      next: `curl -s -H 'Accept: application/json' ${commentsUrl}`,
    };
  }

  const replyExample = result.threads.map((t) => ({
    threadId: t.id,
    text: "<your reply>",
  }));

  return {
    status: "comments" as const,
    threads: result.threads,
    message:
      "New review comments arrived. Make any requested code changes first, then reply in the affected threads with the command below. If a comment does not require code changes, reply right away.",
    next: `curl -s -X POST ${replyUrl} -H 'Content-Type: application/json' -H 'Accept: application/json' -d '${JSON.stringify({ replies: replyExample })}'`,
  };
}

export async function pollComments(
  sessionId: string,
  timeoutMs: number,
  baseUrl: string,
  prefix: string = "plan"
) {
  const session = SessionDO.getInstance(sessionId);
  const result = await session.waitForComments(timeoutMs);
  return formatPollResponse(result, sessionId, baseUrl, prefix);
}

export async function replyToComments(
  sessionId: string,
  replies: { threadId: number; text: string }[],
  timeoutMs: number,
  baseUrl: string,
  prefix: string = "plan"
) {
  const session = SessionDO.getInstance(sessionId);
  const messages: Message[] = [];
  for (const r of replies) {
    const msg = await session.addMessage(r.threadId, "agent", r.text);
    messages.push(msg);
  }
  const result = await session.waitForComments(timeoutMs);
  return {
    sent: messages,
    ...formatPollResponse(result, sessionId, baseUrl, prefix),
  };
}

export async function getComments(sessionId: string) {
  const session = SessionDO.getInstance(sessionId);
  const threads = await session.getThreads();
  const done = await session.isDone();
  return { threads, done };
}
