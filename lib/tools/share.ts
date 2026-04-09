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
    return {
      sessionId,
      url,
      tool: "share",
      openCommands: {
        chromeApp:
          `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ` +
          `--app="${url}#key=$KEY_HEX" &`,
        fallback: `open "${url}#key=$KEY_HEX"`,
      },
      message: [
        "Generate the share key locally, encrypt the document locally, and open the final URL with the key in the fragment.",
        "The server must only receive ciphertext JSON, never plaintext.",
        "Open the final reviewer URL with Chrome app mode after setting KEY_HEX:",
        `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="${url}#key=$KEY_HEX" &`,
        "Fallback:",
        `  open "${url}#key=$KEY_HEX"`,
      ].join("\n"),
      next: [
        "Local OpenSSL recipe:",
        "",
        "  KEY_HEX=$(openssl rand -hex 64)",
        "  ENC_KEY_HEX=${KEY_HEX:0:64}",
        "  MAC_KEY_HEX=${KEY_HEX:64}",
        "  IV_HEX=$(openssl rand -hex 16)",
        "  openssl enc -aes-256-cbc -nosalt -K \"$ENC_KEY_HEX\" -iv \"$IV_HEX\" -in secret.md -out secret.bin",
        "  IV_B64=$(printf '%s' \"$IV_HEX\" | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')",
        "  CIPHERTEXT_B64=$(openssl base64 -A < secret.bin | tr '+/' '-_' | tr -d '=')",
        "  MAC_INPUT=\"aes-256-cbc+hmac-sha256:1:$IV_B64:$CIPHERTEXT_B64\"",
        "  MAC_B64=$(printf '%s' \"$MAC_INPUT\" | openssl dgst -sha256 -mac HMAC -macopt hexkey:$MAC_KEY_HEX -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')",
        "",
        "Then open:",
        `  ${url}#key=$KEY_HEX`,
        "",
        "Then submit the encrypted envelope JSON:",
        `  printf '{"version":1,"alg":"aes-256-cbc+hmac-sha256","iv":"%s","ciphertext":"%s","mac":"%s"}' "$IV_B64" "$CIPHERTEXT_B64" "$MAC_B64" | curl -s -X POST ${baseUrl}/share/${sessionId} \\`,
        `    -H 'Content-Type: application/json' \\`,
        "    --data-binary @-",
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
