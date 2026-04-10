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
        "Ask the user to open this encrypted share page.",
        "If this browser has not enabled end-to-end encryption yet, the page will ask for localStorage permission, generate a local private key, upload a 24-hour public-key reference, and copy short instructions for you.",
        "Wait for the user to paste those instructions back before you encrypt and upload the document.",
        "Prefer Chrome app mode for a clean dedicated window:",
        `  ${chromeApp}`,
        "Fallback:",
        `  ${fallback}`,
      ].join("\n"),
      next: [
        "Flow:",
        "",
        `  1. Open ${url} for the user.`,
        "  2. If the page generates new encryption instructions, wait for the user to paste them back to you.",
        "  3. Prefer local openssl/libressl CLI. Encrypt the markdown with AES-256-CBC + HMAC-SHA256, then wrap aesKey||hmacKey with RSA-OAEP-SHA256.",
        "  4. POST only ciphertext JSON:",
        "",
        `  curl -s -X POST ${baseUrl}/share/${sessionId} \\`,
        `    -H 'Content-Type: application/json' \\`,
        "    --data-binary @encrypted-share.json",
        "",
        '  JSON shape: {"version":3,"alg":"rsa-oaep-256+aes-256-cbc+hmac-sha256","recipientKeyId":"...","encryptedKey":"...","iv":"...","ciphertext":"...","mac":"..."}',
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
