import type { Tool } from "@/lib/tools/types";
import {
  createEncryptedShareSession,
  parseEncryptedShareRequest,
  pollEncryptedShare,
  updateEncryptedShareSession,
} from "@/lib/share";
import { SessionDO } from "@/worker/session";

type ShareActionInput = Awaited<ReturnType<typeof parseEncryptedShareRequest>>;

export const shareTool: Tool<ShareActionInput> = {
  id: "share",

  async bootstrap({ sessionId, baseUrl }) {
    const url = `${baseUrl}/s/${sessionId}`;
    const chromeApp = `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}" &`;
    const fallback = `open "${url}"`;
    return {
      sessionId,
      url,
      tool: "share",
      openCommands: {
        chromeApp,
        fallback,
      },
      message: [
        "Open this encrypted share page for the user. Prefer Chrome app mode:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
        "Then wait for the user to paste copied encryption instructions back to you.",
        "Do not upload anything before you receive those instructions.",
      ].join("\n"),
      next: [
        "Once the user sends copied encryption instructions, follow them exactly.",
        "When the ciphertext envelope is ready, POST only JSON to this session:",
        "",
        `curl -s -X POST ${baseUrl}/share/${sessionId} \\`,
        `  -H 'Content-Type: application/json' \\`,
        "  --data-binary @encrypted-share.json",
        "",
        'JSON shape: {"version":3,"alg":"rsa-oaep-256+aes-256-cbc+hmac-sha256","recipientKeyId":"...","encryptedKey":"...","iv":"...","ciphertext":"...","mac":"..."}',
      ].join("\n"),
    };
  },

  async parseActionRequest(request) {
    return parseEncryptedShareRequest(request);
  },

  async applyAction({ sessionId, baseUrl, input }) {
    const session = SessionDO.getInstance(sessionId);
    const phase = await session.getSessionPhase();
    if (phase === "awaiting_init") {
      await createEncryptedShareSession(sessionId, input, baseUrl);
    } else {
      await updateEncryptedShareSession(sessionId, input, baseUrl);
    }
    return { sessionId, pollPrefix: "share" };
  },

  async poll({ sessionId, baseUrl }) {
    return pollEncryptedShare(sessionId, baseUrl);
  },
};
