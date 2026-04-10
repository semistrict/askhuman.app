import { parsePlaygroundFormData, createPlayground, updatePlayground, pollPlayground } from "@/lib/playground";
import { createEncryptedToolSession, parseMaybeEncryptedEnvelopeRequest, updateEncryptedToolSession } from "@/lib/e2e-session";
import { SessionDO } from "@/worker/session";
import type { Tool } from "@/lib/tools/types";
import { playgroundPollMarkdown } from "@/lib/rest-response";

type PlaygroundActionInput =
  | ReturnType<typeof parsePlaygroundFormData>
  | { encryptedEnvelope: Awaited<ReturnType<typeof parseMaybeEncryptedEnvelopeRequest>> };

export const playgroundTool: Tool<PlaygroundActionInput> = {
  id: "playground",

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "playground",
      openCommands: { chromeApp, fallback },
      message: [
        "Ask the user to open this playground review page.",
        "Prefer end-to-end encryption if the user agrees and their browser allows localStorage.",
        "Wait for the user to either copy end-to-end encryption instructions back to you or explicitly continue without encryption.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "If the user continues without encryption, submit the playground payload normally:",
        "",
        `curl -s -X POST ${baseUrl}/playground/${sessionId} \\`,
        `  -F "html=<playground.html"`,
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    const encryptedEnvelope = await parseMaybeEncryptedEnvelopeRequest(request);
    if (encryptedEnvelope) {
      return { encryptedEnvelope };
    }
    return parsePlaygroundFormData(await request.formData());
  },

  async applyAction({ sessionId, baseUrl, input }) {
    if ("encryptedEnvelope" in input && input.encryptedEnvelope) {
      const session = SessionDO.getInstance(sessionId);
      const phase = await session.getSessionPhase();
      if (phase === "awaiting_init") {
        await createEncryptedToolSession(sessionId, "playground", input.encryptedEnvelope, baseUrl);
      } else {
        await updateEncryptedToolSession(sessionId, "playground", input.encryptedEnvelope, baseUrl);
      }
      return { sessionId, pollPrefix: "playground" };
    }
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createPlayground(sessionId, input.html, baseUrl);
    } else {
      await updatePlayground(sessionId, input.html, baseUrl);
    }
    return { sessionId, pollPrefix: "playground" };
  },

  async poll({ sessionId, baseUrl }) {
    return pollPlayground(sessionId, baseUrl);
  },

  renderPollMarkdown(result) {
    return playgroundPollMarkdown(result as never);
  },
};
