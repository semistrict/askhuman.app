import type { Tool } from "@/lib/tools/types";
import { createEncryptedToolSession, parseMaybeEncryptedEnvelopeRequest, updateEncryptedToolSession } from "@/lib/e2e-session";
import {
  buildDocFileFeedbackClipboardText,
  createFileSession,
  fileReviewPollContext,
  parseFileSubmissionRequest,
  updateFileSession,
} from "@/lib/file-review";
import { SessionDO } from "@/worker/session";

type ReviewActionInput =
  | Awaited<ReturnType<typeof parseFileSubmissionRequest>>
  | { encryptedEnvelope: Awaited<ReturnType<typeof parseMaybeEncryptedEnvelopeRequest>> };

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
        "Open this review page for the user. Prefer Chrome app mode:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
        "Then wait for one of these from the user:",
        "  - copied end-to-end encryption instructions",
        "  - confirmation to continue without encryption",
      ].join("\n"),
      next: [
        "If the user chooses plaintext, POST the review content to this session:",
        "",
        `curl -s -X POST ${baseUrl}/review/${sessionId} \\`,
        `  -F "doc.md=<doc.md"`,
        "",
        "For multiple files:",
        `curl -s -X POST ${baseUrl}/review/${sessionId} \\`,
        `  -F "src/main.ts=<src/main.ts" \\`,
        `  -F "src/utils.ts=<src/utils.ts"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const encryptedEnvelope = await parseMaybeEncryptedEnvelopeRequest(request);
    if (encryptedEnvelope) {
      return { encryptedEnvelope };
    }
    const parsed = await parseFileSubmissionRequest(request);
    return { ...parsed, sessionId: null };
  },

  async applyAction({ sessionId, baseUrl, input }) {
    if ("encryptedEnvelope" in input && input.encryptedEnvelope) {
      const session = SessionDO.getInstance(sessionId);
      const phase = await session.getSessionPhase();
      if (phase === "awaiting_init") {
        await createEncryptedToolSession(sessionId, "review", input.encryptedEnvelope, baseUrl);
      } else {
        await updateEncryptedToolSession(sessionId, "review", input.encryptedEnvelope, baseUrl);
      }
      return { sessionId, pollPrefix: "review" };
    }
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
    const session = SessionDO.getInstance(sessionId);
    if ((await session.getEncryptionMode()) === "e2e") {
      return undefined;
    }
    return fileReviewPollContext(sessionId);
  },
};

export async function buildReviewClipboardText(sessionId: string, baseUrl: string) {
  return buildDocFileFeedbackClipboardText(sessionId, baseUrl).then((text) =>
    text.replaceAll(`/review/${sessionId}/poll`, `/review/${sessionId}/poll`)
  );
}
