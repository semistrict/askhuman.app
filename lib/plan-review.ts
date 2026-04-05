import { PlanSession, type Thread, type Message } from "@/worker/plan-session";

export type { Thread, Message };

export function createSession(): string {
  return crypto.randomUUID();
}

export async function initSession(id: string): Promise<void> {
  const session = PlanSession.getInstance(id);
  await session.getPlan(); // touch to ensure DO initializes
}

export async function submitPlan(
  sessionId: string,
  markdown: string,
  baseUrl: string
) {
  const session = PlanSession.getInstance(sessionId);
  await session.setPlan(markdown);
  const url = `${baseUrl}/session/${sessionId}`;
  const commentsUrl = `${baseUrl}/agent/sessions/${sessionId}/comments`;
  const replyUrl = `${baseUrl}/agent/sessions/${sessionId}/reply`;
  return {
    sessionId,
    url,
    instructions: [
      `1. Open the review page in the user's browser:\n   open "${url}"`,
      `2. Poll for human comments (long-polls up to 2 min, returns immediately when comments arrive):\n   curl -s ${commentsUrl}`,
      `3. The response has a "status" field: "comments" (new feedback), "timeout" (no activity, poll again), or "done" (human finished reviewing).`,
      `4. When status is "comments", reply to all threads and auto-poll for the next round:\n   curl -s -X POST ${replyUrl} -H 'Content-Type: application/json' -d '{"replies":[{"threadId":1,"text":"your reply"}]}'`,
      `5. The reply response also has "status"/"threads" — loop until status is "done".`,
    ],
  };
}

export function formatPollResponse(
  result: { threads: Thread[]; done?: boolean },
  sessionId: string,
  baseUrl: string
) {
  const commentsUrl = `${baseUrl}/agent/sessions/${sessionId}/comments`;
  const replyUrl = `${baseUrl}/agent/sessions/${sessionId}/reply`;

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
      next: `curl -s ${commentsUrl}`,
    };
  }

  const replyExample = result.threads.map((t) => ({
    threadId: t.id,
    text: "<your reply>",
  }));

  return {
    status: "comments" as const,
    threads: result.threads,
    next: `curl -s -X POST ${replyUrl} -H 'Content-Type: application/json' -d '${JSON.stringify({ replies: replyExample })}'`,
  };
}

export async function pollComments(
  sessionId: string,
  timeoutMs: number,
  baseUrl: string
) {
  const session = PlanSession.getInstance(sessionId);
  const result = await session.waitForComments(timeoutMs);
  return formatPollResponse(result, sessionId, baseUrl);
}

export async function replyToComments(
  sessionId: string,
  replies: { threadId: number; text: string }[],
  timeoutMs: number,
  baseUrl: string
) {
  const session = PlanSession.getInstance(sessionId);
  const messages: Message[] = [];
  for (const r of replies) {
    const msg = await session.addMessage(r.threadId, "agent", r.text);
    messages.push(msg);
  }
  const result = await session.waitForComments(timeoutMs);
  return {
    sent: messages,
    ...formatPollResponse(result, sessionId, baseUrl),
  };
}

export async function getComments(sessionId: string) {
  const session = PlanSession.getInstance(sessionId);
  const threads = await session.getThreads();
  const done = await session.isDone();
  return { threads, done };
}
