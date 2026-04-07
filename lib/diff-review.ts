import { createHash } from "node:crypto";
import { HUMAN_CONNECT_TIMEOUT_MS, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import {
  countRenderedHunkLines,
  createStableHunkId,
  prepareDiffReviewRequest,
  parseAndValidateDiff,
  RequestHunksValidationError,
  type MatchableHunk,
  type ParsedHunk,
} from "@/lib/diff-matching";
import { msg } from "@/lib/agent-messages";
import { SessionDO, type Thread } from "@/worker/session";

export { RequestHunksValidationError } from "@/lib/diff-matching";

const MAX_VIEW_LINES = 200;

type PollStatus = "comments" | "timeout" | "done" | "error" | "next";

function requestCurl(baseUrl: string, sessionId: string): string {
  return [
    `curl -s -X POST "${baseUrl}/diff/${sessionId}/request" \\`,
    `  -F description=@description.md \\`,
    `  -F diff=@current.diff`,
  ].join("\n");
}

function pollCurl(baseUrl: string, sessionId: string): string {
  return `curl -s "${baseUrl}/diff/${sessionId}/poll"`;
}

function completeCurl(baseUrl: string, sessionId: string): string {
  return `curl -s -X POST --data-binary @- "${baseUrl}/diff/${sessionId}/complete"`;
}

function dismissRequestCurl(baseUrl: string, sessionId: string): string {
  return `curl -s -X POST "${baseUrl}/diff/${sessionId}/dismiss"`;
}

function requestLimitGuidance(): string {
  return msg("diff_request_limit", { MAX_LINES: MAX_VIEW_LINES });
}

function changePickupReminder(baseUrl: string, sessionId: string): string {
  return msg("diff_change_pickup", { COMPLETE_CURL: completeCurl(baseUrl, sessionId) });
}

function createRequestFingerprint(diff: string, description: string): string {
  return createHash("md5")
    .update(diff)
    .update("\n---\n")
    .update(description)
    .digest("base64url");
}

function isTruthyFormValue(value: string | null): boolean {
  if (!value) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function countDifferentHunks(previousIds: Set<string>, nextIds: Set<string>): number {
  let different = 0;
  for (const id of previousIds) {
    if (!nextIds.has(id)) different += 1;
  }
  for (const id of nextIds) {
    if (!previousIds.has(id)) different += 1;
  }
  return different;
}

async function assertManyChangesAllowed(
  session: DurableObjectStub<SessionDO>,
  nextHunks: MatchableHunk[],
  allowManyChanges: boolean,
  baseUrl: string,
  sessionId: string
) {
  const previousMeta = await session.getHunkMeta();
  if (previousMeta.length === 0) return;

  const previousIds = new Set(previousMeta.map((hunk) => hunk.id));
  const nextIds = new Set(nextHunks.map((hunk) => hunk.id));
  const differentCount = countDifferentHunks(previousIds, nextIds);
  const baselineCount = Math.max(previousIds.size, nextIds.size);

  if (
    differentCount > 4 &&
    baselineCount > 0 &&
    differentCount / baselineCount > 0.5 &&
    !allowManyChanges
  ) {
    throw new RequestHunksValidationError(
      msg("diff_churn_rejected", {
        DIFFERENT_COUNT: differentCount,
        BASELINE_COUNT: baselineCount,
        BASE_URL: baseUrl,
        SESSION_ID: sessionId,
      }),
      409
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

function diffReplyExample(threads: Thread[]): string {
  return threads
    .map((thread) => `-F threadId=${thread.id} -F text='<your reply>'`)
    .join(" ");
}

function diffCommentsMessage(
  baseUrl: string,
  sessionId: string,
  threads: Thread[],
  requestComplete?: boolean
): string {
  return msg("diff_comments", {
    BASE_URL: baseUrl,
    SESSION_ID: sessionId,
    REPLY_EXAMPLE: diffReplyExample(threads),
    REQUEST_COMPLETE_HINT: requestComplete ? msg("diff_request_complete_hint") : "",
    CHANGE_PICKUP: changePickupReminder(baseUrl, sessionId),
  });
}

async function diffNextMessage(
  session: DurableObjectStub<SessionDO>,
  baseUrl: string,
  sessionId: string
): Promise<string> {
  const hasMore = await session.hasAnyUnreviewedHunks();
  return hasMore
    ? msg("diff_next_has_more", { CHANGE_PICKUP: changePickupReminder(baseUrl, sessionId) })
    : msg("diff_next_all_reviewed", { COMPLETE_CURL: completeCurl(baseUrl, sessionId) });
}

async function waitForDiffReviewProgress(
  sessionId: string,
  baseUrl: string
): Promise<{
  status: PollStatus;
  threads: Thread[];
  message: string;
  url?: string;
  next?: string;
}> {
  const session = SessionDO.getInstance(sessionId);
  const url = `${baseUrl}/s/${sessionId}`;
  const immediate = await session.consumeAgentUpdate();
  if (immediate.done || immediate.requestComplete || immediate.threads.length > 0) {
    const result = immediate;
    if (result.done) {
      return { status: "done", threads: result.threads, message: msg("diff_done") };
    }

    if (result.threads.length > 0) {
      return {
        status: "comments",
        threads: result.threads,
        message: diffCommentsMessage(baseUrl, sessionId, result.threads, result.requestComplete),
      };
    }

    return {
      status: "next",
      threads: [],
      message: await diffNextMessage(session, baseUrl, sessionId),
    };
  }

  if (!(await session.hasHumanConnected())) {
    const { connected } = await session.waitForHumanConnection(HUMAN_CONNECT_TIMEOUT_MS);
    if (!connected) {
      return {
        status: "error",
        threads: [],
        url,
        message: msg("diff_not_connected", { URL: url }),
        next: pollCurl(baseUrl, sessionId),
      };
    }
  }

  const result = await session.waitForComments(REST_POLL_TIMEOUT_MS);

  if (result.noHuman) {
    return {
      status: "error",
      threads: [],
      url,
      message: msg("diff_no_human", { URL: url }),
      next: pollCurl(baseUrl, sessionId),
    };
  }

  if (result.done) {
    return { status: "done", threads: result.threads, message: msg("diff_done") };
  }

  if (result.threads.length > 0) {
    return {
      status: "comments",
      threads: result.threads,
      message: diffCommentsMessage(baseUrl, sessionId, result.threads, result.requestComplete),
    };
  }

  if (result.requestComplete) {
    return {
      status: "next",
      threads: [],
      message: await diffNextMessage(session, baseUrl, sessionId),
    };
  }

  return {
    status: "timeout",
    threads: [],
    message: msg("diff_timeout", { CHANGE_PICKUP: changePickupReminder(baseUrl, sessionId) }),
    next: pollCurl(baseUrl, sessionId),
  };
}

export async function getImmediateDiffAgentResponse(
  sessionId: string,
  baseUrl: string
): Promise<{
  sessionId: string;
  url: string;
  status: PollStatus;
  threads: Thread[];
  message: string;
}> {
  const session = SessionDO.getInstance(sessionId);
  const result = await session.peekAgentUpdate();
  const url = `${baseUrl}/s/${sessionId}`;

  if (result.done) {
    return { sessionId, url, status: "done", threads: result.threads, message: msg("diff_done") };
  }

  if (result.threads.length > 0) {
    return {
      sessionId,
      url,
      status: "comments",
      threads: result.threads,
      message: diffCommentsMessage(baseUrl, sessionId, result.threads, result.requestComplete),
    };
  }

  if (result.requestComplete) {
    return {
      sessionId,
      url,
      status: "next",
      threads: [],
      message: await diffNextMessage(session, baseUrl, sessionId),
    };
  }

  return {
    sessionId,
    url,
    status: "timeout",
    threads: [],
    message: msg("diff_timeout_immediate", { CHANGE_PICKUP: changePickupReminder(baseUrl, sessionId) }),
  };
}

export async function submitDiff(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("diff");
  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: msg("diff_session_created", {
      REQUEST_CURL: requestCurl(baseUrl, sessionId),
      REQUEST_LIMIT: requestLimitGuidance(),
      DISMISS_CURL: dismissRequestCurl(baseUrl, sessionId),
      COMPLETE_CURL: completeCurl(baseUrl, sessionId),
    }),
  };
}

export async function requestDiffReview(
  sessionId: string,
  formData: FormData,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    throw new RequestHunksValidationError(msg("diff_already_complete"), 409);
  }

  const description = await readFieldText(formData.get("description"), "description");
  const diff = await readFieldText(formData.get("diff"), "diff");
  const allowManyChanges = isTruthyFormValue(
    typeof formData.get("allow_many_changes") === "string"
      ? (formData.get("allow_many_changes") as string)
      : null
  );
  const fingerprint = createRequestFingerprint(diff, description);

  if (await session.hasActiveReviewRequest()) {
    if (await session.hasMatchingActiveReviewRequest(fingerprint)) {
      // Same request body — fall through to wait
    } else if (!(await session.hasUnreadHumanComments())) {
      // All comments addressed — allow replacement
      await session.setActiveReviewRequest(false);
    } else {
      throw new RequestHunksValidationError(
        msg("diff_request_blocked_unread", { DISMISS_CURL: dismissRequestCurl(baseUrl, sessionId) }),
        409
      );
    }
  }

  if (!(await session.hasActiveReviewRequest())) {
    const { parsed, hunks, sections, selectedHunks } = prepareDiffReviewRequest(
      description,
      diff
    );
    await assertManyChangesAllowed(
      session,
      hunks,
      allowManyChanges,
      baseUrl,
      sessionId
    );

    const totalLines = selectedHunks.reduce(
      (sum, hunk) => sum + countRenderedHunkLines(hunk.content),
      0
    );
    if (selectedHunks.length > 1 && totalLines > MAX_VIEW_LINES) {
      throw new RequestHunksValidationError(
        msg("diff_request_rejected_too_many_lines", {
          HUNK_COUNT: selectedHunks.length,
          TOTAL_LINES: totalLines,
          REQUEST_LIMIT: requestLimitGuidance(),
        })
      );
    }

    await session.replaceHunks(parsed);
    await session.setView(
      description,
      selectedHunks.map((hunk) => hunk.id),
      sections,
      fingerprint
    );
  }

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    ...(await waitForDiffReviewProgress(sessionId, baseUrl)),
  };
}

export async function pollDiffReview(sessionId: string, baseUrl: string) {
  return waitForDiffReviewProgress(sessionId, baseUrl);
}

export async function dismissRequest(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  if (!(await session.hasActiveReviewRequest())) {
    throw new RequestHunksValidationError(msg("diff_dismiss_no_request"), 409);
  }
  if (await session.hasUnreadHumanComments()) {
    throw new RequestHunksValidationError(msg("diff_dismiss_unread"), 409);
  }

  await session.setActiveReviewRequest(false);
  return {
    sessionId,
    message: msg("diff_dismissed", { REQUEST_CURL: requestCurl(baseUrl, sessionId) }),
  };
}

export async function completeDiffReview(
  sessionId: string,
  diff: string,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.hasActiveReviewRequest()) {
    throw new RequestHunksValidationError(msg("diff_complete_while_active"), 409);
  }

  const parsed = parseAndValidateDiff(diff);
  const reviewed = new Set(await session.getReviewedHunkIdsList());
  const missing = parsed.filter((hunk) => !reviewed.has(createStableHunkId(hunk)));

  if (missing.length > 0) {
    throw new RequestHunksValidationError(
      msg("diff_complete_missing_hunks", { COUNT: missing.length }),
      409
    );
  }

  await session.markSessionReviewComplete();
  return { sessionId, message: msg("diff_session_complete") };
}
