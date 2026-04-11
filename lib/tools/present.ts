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
        "Open this presentation review page for the user. Prefer Chrome app mode:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
        "Then wait for one of these from the user:",
        "  - copied end-to-end encryption instructions",
        "  - confirmation to continue without encryption",
      ].join("\n"),
      next: [
        "If the user chooses plaintext, POST the presentation markdown to this session:",
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
