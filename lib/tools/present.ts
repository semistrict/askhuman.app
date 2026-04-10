import { parsePresentationRequest, createPresentationSession, updatePresentationSession } from "@/lib/present";
import { createEncryptedToolSession, parseMaybeEncryptedEnvelopeRequest, updateEncryptedToolSession } from "@/lib/e2e-session";
import { SessionDO } from "@/worker/session";
import type { Tool } from "@/lib/tools/types";

type PresentActionInput =
  | Awaited<ReturnType<typeof parsePresentationRequest>>
  | { encryptedEnvelope: Awaited<ReturnType<typeof parseMaybeEncryptedEnvelopeRequest>> };

export const presentTool: Tool<PresentActionInput> = {
  id: "present",
  aliases: ["remark"],

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "present",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this presentation review page.",
        "Prefer end-to-end encryption if the user agrees and their browser allows localStorage.",
        "Wait for the user to either copy end-to-end encryption instructions back to you or explicitly continue without encryption.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "If the user continues without encryption, submit the presentation payload normally:",
        "",
        `curl -s -X POST ${baseUrl}/present/${sessionId} \\`,
        `  -F "markdown=<slides.md"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const encryptedEnvelope = await parseMaybeEncryptedEnvelopeRequest(request);
    if (encryptedEnvelope) {
      return { encryptedEnvelope };
    }
    const parsed = await parsePresentationRequest(request);
    return { ...parsed, sessionId: null };
  },

  async applyAction({ sessionId, baseUrl, input }) {
    if ("encryptedEnvelope" in input && input.encryptedEnvelope) {
      const session = SessionDO.getInstance(sessionId);
      const phase = await session.getSessionPhase();
      if (phase === "awaiting_init") {
        await createEncryptedToolSession(sessionId, "present", input.encryptedEnvelope, baseUrl);
      } else {
        await updateEncryptedToolSession(sessionId, "present", input.encryptedEnvelope, baseUrl);
      }
      return { sessionId, pollPrefix: "present" };
    }
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createPresentationSession(sessionId, input.markdown, baseUrl);
    } else {
      await updatePresentationSession(sessionId, input.markdown, baseUrl);
    }
    return { sessionId, pollPrefix: "present" };
  },

  async poll({ sessionId, baseUrl }) {
    const { pollPresentation } = await import("@/lib/present");
    return pollPresentation(sessionId, baseUrl);
  },
};
