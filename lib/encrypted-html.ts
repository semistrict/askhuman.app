export const ENCRYPTED_HTML_VERSION = 1 as const;
export const ENCRYPTED_HTML_ALGORITHM = "aes-256-cbc+hmac-sha256" as const;
export const ENCRYPTED_HTML_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ENCRYPTED_HTML_KEY_BASE64URL_LENGTH = 86;
export const MAX_CIPHERTEXT_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_JSON_BYTES = 15 * 1024 * 1024;

const AES_KEY_BYTES = 32;
const HMAC_KEY_BYTES = 32;
const URL_KEY_BYTES = AES_KEY_BYTES + HMAC_KEY_BYTES;
const CBC_IV_BYTES = 16;
const HMAC_BYTES = 32;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_BASE64_URL_RE = /^[A-Za-z0-9_-]{86}$/;

export type EncryptedHtmlPayload = {
  version: typeof ENCRYPTED_HTML_VERSION;
  alg: typeof ENCRYPTED_HTML_ALGORITHM;
  filename?: string;
  iv: string;
  ciphertext: string;
  mac: string;
};

export type EncryptedHtmlBundle = {
  payload: EncryptedHtmlPayload;
  key: string;
};

function normalizeBase64(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function decodeBase64Url(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(normalizeBase64(value), "base64"));
  }

  const binary = globalThis.atob(normalizeBase64(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function expectBase64UrlField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || !BASE64_URL_RE.test(value)) {
    throw new Error(`${name} must be a non-empty base64url string.`);
  }
  return value;
}

function expectDecodedLength(value: string, name: string, expected: number): void {
  const length = decodeBase64Url(value).byteLength;
  if (length !== expected) {
    throw new Error(`${name} must decode to ${expected} bytes.`);
  }
}

export function parseEncryptedHtmlPayload(value: unknown): EncryptedHtmlPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Payload must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  if ("key" in record || "html" in record || "plaintext" in record || "content" in record) {
    throw new Error("Upload only encrypted payload fields; never include plaintext or keys.");
  }
  if (record.version !== ENCRYPTED_HTML_VERSION) {
    throw new Error(`Unsupported encrypted HTML version: ${String(record.version)}`);
  }
  if (record.alg !== ENCRYPTED_HTML_ALGORITHM) {
    throw new Error(`Unsupported encrypted HTML algorithm: ${String(record.alg)}`);
  }

  const filename =
    typeof record.filename === "string" && record.filename.trim()
      ? validateFilename(record.filename.trim())
      : undefined;
  const iv = expectBase64UrlField(record.iv, "iv");
  const ciphertext = expectBase64UrlField(record.ciphertext, "ciphertext");
  const mac = expectBase64UrlField(record.mac, "mac");

  expectDecodedLength(iv, "iv", CBC_IV_BYTES);
  expectDecodedLength(mac, "mac", HMAC_BYTES);
  const ciphertextBytes = decodeBase64Url(ciphertext).byteLength;
  if (ciphertextBytes === 0) {
    throw new Error("ciphertext must not be empty.");
  }
  if (ciphertextBytes > MAX_CIPHERTEXT_BYTES) {
    throw new Error(`ciphertext must be ${MAX_CIPHERTEXT_BYTES} bytes or smaller.`);
  }

  return {
    version: ENCRYPTED_HTML_VERSION,
    alg: ENCRYPTED_HTML_ALGORITHM,
    ...(filename ? { filename } : {}),
    iv,
    ciphertext,
    mac,
  };
}

function validateFilename(filename: string): string {
  if (filename.length > 160 || /[/\\]/.test(filename)) {
    throw new Error("filename must be a short file name, not a path.");
  }
  return filename;
}

export function parseUrlKey(key: string): Uint8Array {
  const trimmed = key.trim();
  if (!KEY_BASE64_URL_RE.test(trimmed)) {
    throw new Error("URL key must be an 86-character base64url string.");
  }

  const bytes = decodeBase64Url(trimmed);
  if (bytes.byteLength !== URL_KEY_BYTES) {
    throw new Error("URL key must decode to 64 bytes.");
  }
  return bytes;
}

async function importAesKey(rawKey: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-CBC" },
    false,
    [usage]
  );
}

async function importHmacKey(rawKey: Uint8Array, usage: "sign" | "verify"): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

export async function decryptEncryptedHtmlPayload(
  payloadInput: EncryptedHtmlPayload,
  key: string
): Promise<string> {
  const payload = parseEncryptedHtmlPayload(payloadInput);
  const keyBytes = parseUrlKey(key);
  const aesKeyBytes = keyBytes.slice(0, AES_KEY_BYTES);
  const macKeyBytes = keyBytes.slice(AES_KEY_BYTES);
  const iv = decodeBase64Url(payload.iv);
  const ciphertext = decodeBase64Url(payload.ciphertext);
  const mac = decodeBase64Url(payload.mac);

  const macKey = await importHmacKey(macKeyBytes, "verify");
  const ok = await globalThis.crypto.subtle.verify(
    "HMAC",
    macKey,
    toArrayBuffer(mac),
    toArrayBuffer(concatBytes(iv, ciphertext))
  );
  if (!ok) {
    throw new Error("Encrypted HTML integrity check failed.");
  }

  const aesKey = await importAesKey(aesKeyBytes, "decrypt");
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export async function createEncryptedHtmlPayload(
  html: string,
  options: { filename?: string; key?: string } = {}
): Promise<EncryptedHtmlBundle> {
  const key = options.key ?? encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(URL_KEY_BYTES)));
  const keyBytes = parseUrlKey(key);
  const aesKeyBytes = keyBytes.slice(0, AES_KEY_BYTES);
  const macKeyBytes = keyBytes.slice(AES_KEY_BYTES);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(CBC_IV_BYTES));
  const aesKey = await importAesKey(aesKeyBytes, "encrypt");
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-CBC", iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(new TextEncoder().encode(html))
    )
  );
  const macKey = await importHmacKey(macKeyBytes, "sign");
  const mac = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      macKey,
      toArrayBuffer(concatBytes(iv, ciphertext))
    )
  );

  return {
    key,
    payload: parseEncryptedHtmlPayload({
      version: ENCRYPTED_HTML_VERSION,
      alg: ENCRYPTED_HTML_ALGORITHM,
      ...(options.filename ? { filename: options.filename } : {}),
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(ciphertext),
      mac: encodeBase64Url(mac),
    }),
  };
}
