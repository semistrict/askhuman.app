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
        "Open this playground review page for the user. Prefer Chrome app mode:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
        "Then wait for one of these from the user:",
        "  - copied end-to-end encryption instructions",
        "  - confirmation to continue without encryption",
      ].join("\n"),
      next: [
        "If the user chooses plaintext, POST the playground HTML to this session:",
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
