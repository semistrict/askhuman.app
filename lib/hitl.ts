import { SessionDO, type Message, type Thread } from "@/worker/session";
import { msg } from "@/lib/agent-messages";

export type { Thread, Message };

export const REST_POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const HUMAN_CONNECT_TIMEOUT_MS = 5 * 1000;

type PollStatus = "comments" | "timeout" | "done" | "error";
type AgentConnectionKind =
  | "plan_poll"
  | "plan_reply"
  | "diff_reply"
  | "diff_poll"
  | "file_poll"
  | "file_reply"
  | "playground_poll";

function reviewUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/s/${sessionId}`;
}

function pollUrl(baseUrl: string, sessionId: string, prefix: string): string {
  return `${baseUrl}/${prefix}/${sessionId}/poll`;
}

function replyUrl(baseUrl: string, sessionId: string, prefix: string): string {
  return `${baseUrl}/${prefix}/${sessionId}/reply`;
}

type ReplyInput = { threadId: number; text: string };

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function formatReplyCurl(
  baseUrl: string,
  sessionId: string,
  prefix: string,
  replies: ReplyInput[]
): string {
  const parts = [
    `curl -s -X POST ${replyUrl(baseUrl, sessionId, prefix)}`,
    ...replies.flatMap((reply) => [
      `-F threadId=${reply.threadId}`,
      `-F text=${shellSingleQuote(reply.text)}`,
    ]),
  ];
  return parts.join(" ");
}

function changePickupReminder(prefix: string, _baseUrl: string, _sessionId: string): string {
  if (prefix === "diff") return msg("plan_change_pickup_diff");
  if (prefix === "files") return msg("plan_change_pickup_files");
  return msg("plan_change_pickup_generic");
}

function appendMessage(message: string | undefined, extra: string): string {
  if (!message) return extra;
  if (message.includes(extra)) return message;
  return `${message} ${extra}`;
}

function notConnectedResponse(
  sessionId: string,
  baseUrl: string,
  prefix: string
) {
  const url = reviewUrl(baseUrl, sessionId);
  return {
    status: "error" as PollStatus,
    threads: [] as Thread[],
    message: msg("plan_not_connected", { URL: url }),
    next: `curl -s ${pollUrl(baseUrl, sessionId, prefix)}`,
    url,
  };
}

function disconnectedResponse(
  sessionId: string,
  baseUrl: string,
  prefix: string
) {
  const url = reviewUrl(baseUrl, sessionId);
  return {
    status: "error" as PollStatus,
    threads: [] as Thread[],
    message: msg("plan_no_human", { URL: url }),
    next: `curl -s ${pollUrl(baseUrl, sessionId, prefix)}`,
    url,
  };
}

export function formatPollResponse(
  result: { threads: Thread[]; done?: boolean; noHuman?: boolean },
  sessionId: string,
  baseUrl: string,
  prefix: string = "plan"
) {
  if (result.noHuman) {
    return disconnectedResponse(sessionId, baseUrl, prefix);
  }
  if (result.done) {
    return {
      status: "done" as PollStatus,
      threads: result.threads,
      message: msg("plan_done"),
    };
  }

  if (result.threads.length === 0) {
    return {
      status: "timeout" as PollStatus,
      threads: [] as Thread[],
      message: msg("plan_timeout"),
      next: `curl -s ${pollUrl(baseUrl, sessionId, prefix)}`,
    };
  }

  return {
    status: "comments" as PollStatus,
    threads: result.threads,
    message:
      [
        msg("plan_comments"),
        changePickupReminder(prefix, baseUrl, sessionId),
      ].filter(Boolean).join(" "),
  };
}

async function waitForPollResult(
  sessionId: string,
  timeoutMs: number,
  baseUrl: string,
  prefix: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    const threads = await session.getThreads();
    return formatPollResponse({ threads, done: true }, sessionId, baseUrl, prefix);
  }
  if (!(await session.hasHumanConnected())) {
    const { connected } = await session.waitForHumanConnection(HUMAN_CONNECT_TIMEOUT_MS);
    if (!connected) {
      return notConnectedResponse(sessionId, baseUrl, prefix);
    }
  }

  const result = await session.waitForComments(timeoutMs);
  return formatPollResponse(result, sessionId, baseUrl, prefix);
}

export async function withTrackedAgentLongPoll<T>(
  request: Request,
  sessionId: string,
  kind: AgentConnectionKind,
  run: () => Promise<T>
): Promise<T> {
  const session = SessionDO.getInstance(sessionId);
  const agentId = await session.startAgentConnection({
    sessionId,
    endpoint: new URL(request.url).pathname,
    kind,
    userAgent: request.headers.get("user-agent"),
  });
  try {
    return await run();
  } finally {
    await session.endAgentConnection(agentId);
  }
}

export async function pollComments(
  sessionId: string,
  timeoutMs: number,
  baseUrl: string,
  prefix: string = "plan"
) {
  return waitForPollResult(sessionId, timeoutMs, baseUrl, prefix);
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
  const result = await waitForPollResult(sessionId, timeoutMs, baseUrl, prefix);
  return {
    sent: messages,
    ...result,
    message: appendMessage(
      result.message,
      changePickupReminder(prefix, baseUrl, sessionId)
    ),
  };
}

export async function parseRepliesRequest(request: Request): Promise<ReplyInput[]> {
  const contentType = request.headers.get("content-type") || "";

  if (/\bapplication\/json\b/i.test(contentType)) {
    const body = (await request.json()) as { replies?: ReplyInput[] };
    return body.replies ?? [];
  }

  const formData = await request.formData();
  const threadIds = formData.getAll("threadId");
  const texts = formData.getAll("text");

  if (threadIds.length !== texts.length) {
    throw new Error(msg("form_mismatched_replies"));
  }

  return threadIds.map((threadId, index) => ({
    threadId: Number(threadId),
    text: String(texts[index] ?? ""),
  }));
}
