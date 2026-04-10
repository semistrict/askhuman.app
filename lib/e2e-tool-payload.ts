import type { ToolId } from "@/lib/tools/types";

export type ReviewFile = {
  path: string;
  content: string;
};

export type EncryptedReviewPayload = {
  type: "review";
  files: ReviewFile[];
  response?: string | null;
};

export type EncryptedDiffPayload = {
  type: "diff";
  description: string;
  diff: string;
};

export type EncryptedPresentPayload = {
  type: "present";
  markdown: string;
};

export type EncryptedPlaygroundPayload = {
  type: "playground";
  html: string;
};

export type EncryptedToolPayload =
  | EncryptedReviewPayload
  | EncryptedDiffPayload
  | EncryptedPresentPayload
  | EncryptedPlaygroundPayload;

export function isEncryptedDocReviewPayload(
  payload: EncryptedToolPayload
): payload is EncryptedReviewPayload {
  return (
    payload.type === "review" &&
    payload.files.length === 1 &&
    /\.md$/i.test(payload.files[0]?.path ?? "")
  );
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function parseReviewPayload(value: unknown): EncryptedReviewPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Encrypted review payload must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const files = Array.isArray(record.files)
    ? record.files.map((file) => {
        if (!file || typeof file !== "object") {
          throw new Error("Encrypted review files must be JSON objects.");
        }
        const next = file as Record<string, unknown>;
        return {
          path: expectString(next.path, "Encrypted review file path"),
          content: expectString(next.content, "Encrypted review file content"),
        };
      })
    : null;
  if (!files || files.length === 0) {
    throw new Error("Encrypted review payload must include at least one file.");
  }
  return {
    type: "review",
    files,
    response:
      typeof record.response === "string"
        ? record.response
        : record.response == null
          ? null
          : (() => {
              throw new Error("Encrypted review response must be a string when provided.");
            })(),
  };
}

function parseDiffPayload(value: unknown): EncryptedDiffPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Encrypted diff payload must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  return {
    type: "diff",
    description: expectString(record.description, "Encrypted diff description"),
    diff: expectString(record.diff, "Encrypted diff"),
  };
}

function parsePresentPayload(value: unknown): EncryptedPresentPayload {
  if (typeof value === "string") {
    return {
      type: "present",
      markdown: value,
    };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Encrypted presentation payload must be a markdown string or JSON object.");
  }
  const record = value as Record<string, unknown>;
  return {
    type: "present",
    markdown: expectString(record.markdown, "Encrypted presentation markdown"),
  };
}

function parsePlaygroundPayload(value: unknown): EncryptedPlaygroundPayload {
  if (typeof value === "string") {
    return {
      type: "playground",
      html: value,
    };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Encrypted playground payload must be an HTML string or JSON object.");
  }
  const record = value as Record<string, unknown>;
  return {
    type: "playground",
    html: expectString(record.html, "Encrypted playground html"),
  };
}

export function parseEncryptedToolPayload(
  toolId: Exclude<ToolId, "share">,
  plaintext: string
): EncryptedToolPayload {
  if (toolId === "review") {
    const parsed = JSON.parse(plaintext) as { type?: string };
    const payload = parseReviewPayload(parsed);
    if (parsed.type && parsed.type !== payload.type) {
      throw new Error(`Encrypted payload type mismatch: expected review, got ${parsed.type}.`);
    }
    return payload;
  }
  if (toolId === "diff") {
    const parsed = JSON.parse(plaintext) as { type?: string };
    const payload = parseDiffPayload(parsed);
    if (parsed.type && parsed.type !== payload.type) {
      throw new Error(`Encrypted payload type mismatch: expected diff, got ${parsed.type}.`);
    }
    return payload;
  }
  if (toolId === "present") {
    let parsed: unknown = plaintext;
    const trimmed = plaintext.trim();
    if (trimmed.startsWith("{")) {
      parsed = JSON.parse(plaintext) as { type?: string };
    }
    const payload = parsePresentPayload(parsed);
    if (
      parsed &&
      typeof parsed === "object" &&
      "type" in parsed &&
      (parsed as { type?: string }).type &&
      (parsed as { type?: string }).type !== payload.type
    ) {
      throw new Error(`Encrypted payload type mismatch: expected present, got ${parsed.type}.`);
    }
    return payload;
  }
  let parsed: unknown = plaintext;
  const trimmed = plaintext.trim();
  if (trimmed.startsWith("{")) {
    parsed = JSON.parse(plaintext) as { type?: string };
  }
  const payload = parsePlaygroundPayload(parsed);
  if (
    parsed &&
    typeof parsed === "object" &&
    "type" in parsed &&
    (parsed as { type?: string }).type &&
    (parsed as { type?: string }).type !== payload.type
  ) {
    throw new Error(`Encrypted payload type mismatch: expected playground, got ${parsed.type}.`);
  }
  return payload;
}

function reviewPlaintextExample(): string {
  return JSON.stringify(
    {
      type: "review",
      files: [
        { path: "doc.md", content: "# Draft\n\nReview this document." },
      ],
    },
    null,
    2
  );
}

function diffPlaintextExample(): string {
  return JSON.stringify(
    {
      type: "diff",
      description: "## Summary\n\nDescribe the change here.",
      diff: "diff --git a/file.txt b/file.txt\n@@ -1 +1 @@\n-old\n+new",
    },
    null,
    2
  );
}

function presentPlaintextExample(): string {
  return "# Slide 1\n\nHello\n\n---\n\n# Slide 2";
}

function playgroundPlaintextExample(): string {
  return "<!doctype html><html><body><button>Click</button></body></html>";
}

export function encryptedToolPlaintextExample(toolId: Exclude<ToolId, "share">): string {
  if (toolId === "review") return reviewPlaintextExample();
  if (toolId === "diff") return diffPlaintextExample();
  if (toolId === "present") return presentPlaintextExample();
  return playgroundPlaintextExample();
}

export function buildEncryptedToolAgentInstructions(args: {
  toolId: Exclude<ToolId, "share">;
  sessionId: string;
  baseUrl: string;
  publicKeyUrl: string;
}): string {
  const submitUrl = `${args.baseUrl}/${args.toolId}/${args.sessionId}`;
  const plaintextDescription =
    args.toolId === "present"
      ? "Construct the plaintext UTF-8 markdown for this presentation."
      : args.toolId === "playground"
        ? "Construct the plaintext UTF-8 HTML for this playground."
      : "Construct the plaintext UTF-8 JSON payload for this tool.";
  const plaintextLabel =
    args.toolId === "present"
      ? "Plaintext markdown before encryption:"
      : args.toolId === "playground"
        ? "Plaintext HTML before encryption:"
      : "Plaintext JSON shape before encryption:";
  const plaintextWarning =
    args.toolId === "present"
      ? "Never send the plaintext markdown or any private key material to the server."
      : args.toolId === "playground"
        ? "Never send the plaintext HTML or any private key material to the server."
      : "Never send the plaintext JSON or any private key material to the server.";
  return [
    `Use end-to-end encryption for my askhuman ${args.toolId} session.`,
    "",
    "Prefer local openssl or libressl CLI for this encryption flow. Do not rely on Node.",
    `1. Fetch the recipient public key JSON from ${args.publicKeyUrl}`,
    "   It returns recipientKeyId and publicKeySpki. This short-lived URL expires after 24 hours.",
    `2. ${plaintextDescription}`,
    "3. Base64url-decode publicKeySpki to DER and convert it into an RSA public key that openssl can read.",
    "4. Generate a fresh 32-byte AES key, a fresh 32-byte HMAC key, and a fresh 16-byte IV.",
    "5. Encrypt that plaintext with AES-256-CBC using the AES key and IV.",
    "6. Compute HMAC-SHA256 over iv || ciphertext using the HMAC key.",
    "7. Concatenate aesKey || hmacKey and encrypt that 64-byte blob with RSA-OAEP-SHA256 using the fetched public key.",
    "8. Base64url-encode encryptedKey, iv, ciphertext, and mac.",
    `9. POST only ciphertext JSON to ${submitUrl} in this exact shape:`,
    `{"version":3,"alg":"rsa-oaep-256+aes-256-cbc+hmac-sha256","recipientKeyId":"...","encryptedKey":"...","iv":"...","ciphertext":"...","mac":"..."}`,
    "",
    plaintextLabel,
    encryptedToolPlaintextExample(args.toolId),
    "",
    plaintextWarning,
  ].join("\n");
}

export function buildPlainToolContinueInstructions(args: {
  toolId: Exclude<ToolId, "share">;
  sessionId: string;
  baseUrl: string;
}): string {
  const url = `${args.baseUrl}/s/${args.sessionId}`;
  if (args.toolId === "review") {
    return [
      `I opened the review page: ${url}`,
      "Continue without end-to-end encryption for this session.",
      `POST the review content now to ${args.baseUrl}/review/${args.sessionId}.`,
      "Use plain multipart form submission exactly as you normally would.",
    ].join("\n");
  }
  if (args.toolId === "diff") {
    return [
      `I opened the diff review page: ${url}`,
      "Continue without end-to-end encryption for this session.",
      `POST the diff payload now to ${args.baseUrl}/diff/${args.sessionId}.`,
      "Use the normal description + diff multipart form submission.",
    ].join("\n");
  }
  if (args.toolId === "present") {
    return [
      `I opened the presentation review page: ${url}`,
      "Continue without end-to-end encryption for this session.",
      `POST the presentation markdown now to ${args.baseUrl}/present/${args.sessionId}.`,
      "Use the normal plaintext submission.",
    ].join("\n");
  }
  return [
    `I opened the playground review page: ${url}`,
    "Continue without end-to-end encryption for this session.",
    `POST the playground HTML now to ${args.baseUrl}/playground/${args.sessionId}.`,
    "Use the normal plaintext submission.",
  ].join("\n");
}
