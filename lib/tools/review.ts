import type { Tool } from "@/lib/tools/types";
import {
  buildDocFileFeedbackClipboardText,
  createFileSession,
  fileReviewPollContext,
  parseFileSubmissionRequest,
  updateFileSession,
} from "@/lib/file-review";
import { SessionDO } from "@/worker/session";

type ReviewActionInput = Awaited<ReturnType<typeof parseFileSubmissionRequest>>;

export const reviewTool: Tool<ReviewActionInput> = {
  id: "review",
  aliases: ["files", "plan"],

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "review",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this review page.",
        "Do not wait for confirmation after launching it.",
        "Immediately submit the review payload in the next request.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "Immediately after opening the page, submit the review payload:",
        "",
        `curl -s -X POST ${baseUrl}/review/${sessionId} \\`,
        `  -F "doc.md=<doc.md"`,
        "",
        "Or, for multiple files:",
        `curl -s -X POST ${baseUrl}/review/${sessionId} \\`,
        `  -F "src/main.ts=<src/main.ts" \\`,
        `  -F "src/utils.ts=<src/utils.ts"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const parsed = await parseFileSubmissionRequest(request);
    return { ...parsed, sessionId: null };
  },

  async applyAction({ sessionId, baseUrl, input }) {
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createFileSession(sessionId, input.files, baseUrl);
    } else {
      await updateFileSession(sessionId, input.files, baseUrl, input.response);
    }
    return { sessionId, pollPrefix: "review" };
  },

  async poll({ sessionId, baseUrl }) {
    const { pollFileReview } = await import("@/lib/file-review");
    return pollFileReview(sessionId, baseUrl);
  },

  async buildPollContext(sessionId) {
    return fileReviewPollContext(sessionId);
  },
};

export async function buildReviewClipboardText(sessionId: string, baseUrl: string) {
  return buildDocFileFeedbackClipboardText(sessionId, baseUrl).then((text) =>
    text.replaceAll(`/review/${sessionId}/poll`, `/review/${sessionId}/poll`)
  );
}
