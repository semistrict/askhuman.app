import { createDiffSession, parseFormData, updateDiffSession } from "@/lib/diff-review";
import { createEncryptedToolSession, parseMaybeEncryptedEnvelopeRequest, updateEncryptedToolSession } from "@/lib/e2e-session";
import { SessionDO } from "@/worker/session";
import type { Tool } from "@/lib/tools/types";
import type { ContentContext } from "@/lib/rest-response";

type DiffActionInput =
  | Awaited<ReturnType<typeof parseFormData>>
  | { encryptedEnvelope: Awaited<ReturnType<typeof parseMaybeEncryptedEnvelopeRequest>> };

export const diffTool: Tool<DiffActionInput> = {
  id: "diff",

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "diff",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this diff review page.",
        "Prefer end-to-end encryption if the user agrees and their browser allows localStorage.",
        "Wait for the user to either copy end-to-end encryption instructions back to you or explicitly continue without encryption.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "If the user continues without encryption, submit the diff payload normally:",
        "",
        `curl -s -X POST ${baseUrl}/diff/${sessionId} \\`,
        `  -F description=@description.md \\`,
        `  -F diff=@current.diff`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const encryptedEnvelope = await parseMaybeEncryptedEnvelopeRequest(request);
    if (encryptedEnvelope) {
      return { encryptedEnvelope };
    }
    const parsed = await parseFormData(await request.formData());
    return { ...parsed, sessionId: null };
  },

  async applyAction({ sessionId, baseUrl, input }) {
    if ("encryptedEnvelope" in input && input.encryptedEnvelope) {
      const session = SessionDO.getInstance(sessionId);
      const phase = await session.getSessionPhase();
      if (phase === "awaiting_init") {
        await createEncryptedToolSession(sessionId, "diff", input.encryptedEnvelope, baseUrl);
      } else {
        await updateEncryptedToolSession(sessionId, "diff", input.encryptedEnvelope, baseUrl);
      }
      return { sessionId, pollPrefix: "diff" };
    }
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createDiffSession(sessionId, input.description, input.diff, baseUrl, input.skipLengthCheck);
    } else {
      await updateDiffSession(sessionId, input.description, input.diff, baseUrl, input.skipLengthCheck);
    }
    return { sessionId, pollPrefix: "diff" };
  },

  async poll({ sessionId, baseUrl }) {
    const { pollDiffReview } = await import("@/lib/diff-review");
    return pollDiffReview(sessionId, baseUrl);
  },

  async buildPollContext(sessionId): Promise<ContentContext | undefined> {
    const session = SessionDO.getInstance(sessionId);
    if ((await session.getEncryptionMode()) === "e2e") {
      return undefined;
    }
    const hunks = await session.getAllHunks();
    const context = new Map<string, string[]>();
    for (const hunk of hunks) {
      context.set(hunk.id, hunk.content.split("\n"));
    }
    return context;
  },
};
