import {
  HUMAN_CONNECT_TIMEOUT_MS,
  pollComments,
  REST_POLL_TIMEOUT_MS,
} from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO, type Thread } from "@/worker/session";
import { formatPollResponse } from "@/lib/hitl";
import { pollMarkdown, type ContentContext } from "@/lib/rest-response";

export class FileReviewError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "FileReviewError";
    this.status = status;
  }
}

export function isMarkdownFile(path: string): boolean {
  return /\.md$/i.test(path);
}

function isDocReviewFiles(files: { path: string; content: string }[]): boolean {
  return files.length === 1 && isMarkdownFile(files[0]?.path ?? "");
}

function getPendingDocThreads(threads: Thread[]): Thread[] {
  return threads.filter((thread) => {
    const first = thread.messages[0];
    return !thread.outdated && thread.hunk_id == null && thread.file_path == null && first?.role === "human";
  });
}

export async function getDocReviewFile(sessionId: string): Promise<{ path: string; content: string } | null> {
  const session = SessionDO.getInstance(sessionId);
  const files = await session.getAllFiles();
  return files.length === 1 && isMarkdownFile(files[0]?.path ?? "") ? files[0] : null;
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
  const isDocReview = isDocReviewFiles(files);
  await session.setReviewMode(isDocReview ? "doc" : "files");
  if (isDocReview) {
    await session.setDocReviewState("ready");
  }
  await session.replaceFiles(files);

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: isDocReview
      ? msg("file_doc_created", {
          BASE_URL: baseUrl,
          SESSION_ID: sessionId,
          FILE_PATH: files[0].path,
        })
      : msg("file_created", {
          BASE_URL: baseUrl,
          SESSION_ID: sessionId,
          FILE_COUNT: files.length,
        }),
  };
}

export async function updateFileSession(
  sessionId: string,
  files: { path: string; content: string }[],
  baseUrl: string,
  response: string | null = null
) {
  if (files.length === 0) {
    throw new FileReviewError(msg("file_no_files"));
  }

  const session = SessionDO.getInstance(sessionId);
  const isDocReview = isDocReviewFiles(files);

  if (await session.isDone()) {
    await session.resetDone();
  }

  await session.setReviewMode(isDocReview ? "doc" : "files");
  if (isDocReview) {
    await session.setDocReviewState("ready");
    await session.markOutdatedDocThreads();
  } else {
    const currentPaths = new Set(files.map((f) => f.path));
    await session.markOutdatedFileThreads(currentPaths);
  }
  await session.replaceFiles(files);
  if (isDocReview && response?.trim()) {
    await session.createAgentThread(response.trim());
  }
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
    message: isDocReview
      ? msg("file_doc_updated", { FILE_PATH: files[0].path })
      : msg("file_updated", { FILE_COUNT: files.length }),
  };
}

export async function pollFileReview(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  if ((await session.getReviewMode()) === "doc") {
    return pollDocFileReview(sessionId, baseUrl);
  }
  return pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "review");
}

async function pollDocFileReview(sessionId: string, baseUrl: string) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    const file = await getDocReviewFile(sessionId);
    const result = formatPollResponse(
      { threads: getPendingDocThreads(await session.getThreads()), done: true },
      sessionId,
      baseUrl,
      "plan"
    );
    return {
      ...result,
      message: msg("file_doc_done", {
        BASE_URL: baseUrl,
        SESSION_ID: sessionId,
        FILE_PATH: file?.path ?? "doc.md",
      }),
      next: undefined,
    };
  }

  if (!(await session.hasHumanConnected())) {
    const { connected } = await session.waitForHumanConnection(HUMAN_CONNECT_TIMEOUT_MS);
    if (!connected) {
      const url = `${baseUrl}/s/${sessionId}`;
      return {
        status: "error" as const,
        threads: [],
        message: msg("plan_not_connected", { URL: url }),
        next: `curl -s ${baseUrl}/review/${sessionId}/poll`,
        url,
      };
    }
  }

  const result = await session.waitForComments(REST_POLL_TIMEOUT_MS);
  if (result.noHuman) {
    const url = `${baseUrl}/s/${sessionId}`;
    return {
      status: "error" as const,
      threads: [],
      message: msg("plan_no_human", { URL: url }),
      next: `curl -s ${baseUrl}/review/${sessionId}/poll`,
      url,
    };
  }
  if (!result.done) {
    return {
      status: "timeout" as const,
      threads: [],
      message: msg("doc_timeout"),
      next: `curl -s ${baseUrl}/review/${sessionId}/poll`,
    };
  }

  const file = await getDocReviewFile(sessionId);
  return {
    status: "done" as const,
    threads: getPendingDocThreads(result.threads),
    message: msg("file_doc_done", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
      FILE_PATH: file?.path ?? "doc.md",
    }),
  };
}

export async function fileReviewPollContext(sessionId: string): Promise<ContentContext | undefined> {
  const session = SessionDO.getInstance(sessionId);
  if ((await session.getReviewMode()) === "doc") {
    const file = await getDocReviewFile(sessionId);
    if (!file) return undefined;
    const context = new Map<string, string[]>();
    context.set("__plan__", file.content.split("\n"));
    return context;
  }

  const files = await session.getAllFiles();
  const context = new Map<string, string[]>();
  for (const file of files) {
    context.set(file.path, file.content.split("\n"));
  }
  return context;
}

const RESERVED_FIELDS = new Set(["sessionId", "response"]);

export function parseFileFormData(formData: FormData): {
  files: { path: string; content: string }[];
  sessionId: string | null;
  response: string | null;
} {
  const sessionIdVal = formData.get("sessionId");
  const sessionId =
    typeof sessionIdVal === "string" && sessionIdVal.trim()
      ? sessionIdVal.trim()
      : null;
  const responseVal = formData.get("response");
  const response =
    typeof responseVal === "string" && responseVal.trim() ? responseVal.trim() : null;

  const files: { path: string; content: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (RESERVED_FIELDS.has(key)) continue;
    const content = typeof value === "string" ? value : "";
    if (content) {
      files.push({ path: key, content });
    }
  }

  return { files, sessionId, response };
}

export async function parseFileSubmissionRequest(request: Request): Promise<{
  files: { path: string; content: string }[];
  sessionId: string | null;
  response: string | null;
}> {
  const contentType = request.headers.get("content-type") || "";

  if (/\bmultipart\/form-data\b/i.test(contentType)) {
    return parseFileFormData(await request.formData());
  }

  const markdown = await request.text();
  return {
    files: markdown.trim() ? [{ path: "doc.md", content: markdown }] : [],
    sessionId: null,
    response: null,
  };
}

export async function buildDocFileFeedbackClipboardText(
  sessionId: string,
  baseUrl: string
): Promise<string> {
  const session = SessionDO.getInstance(sessionId);
  const file = await getDocReviewFile(sessionId);
  const result = {
    status: "done" as const,
    threads: getPendingDocThreads(await session.getThreads()),
    message: msg("file_doc_done", {
      BASE_URL: baseUrl,
      SESSION_ID: sessionId,
      FILE_PATH: file?.path ?? "doc.md",
    }),
    context: await fileReviewPollContext(sessionId),
  };
  return `${pollMarkdown(result)}\n\nAfter you submit the updated file, poll again with \`curl -s ${baseUrl}/review/${sessionId}/poll\`.`;
}
