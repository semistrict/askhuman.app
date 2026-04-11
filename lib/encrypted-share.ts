import type { ToolId } from "@/lib/tools/types";

export const ENCRYPTED_SHARE_VERSION = 3 as const;
export const ENCRYPTED_SHARE_ALGORITHM = "rsa-oaep-256+aes-256-cbc+hmac-sha256" as const;
export const ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY = "askhuman.encrypted-share.keypair";

const AES_KEY_BYTES = 32;
const HMAC_KEY_BYTES = 32;
const WRAPPED_KEY_BYTES = AES_KEY_BYTES + HMAC_KEY_BYTES;
const CBC_IV_BYTES = 16;
const HMAC_BYTES = 32;

const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

export type EncryptedSharePayload = {
  version: typeof ENCRYPTED_SHARE_VERSION;
  alg: typeof ENCRYPTED_SHARE_ALGORITHM;
  recipientKeyId: string;
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  mac: string;
};

export type StoredEncryptedShareKeyPair = {
  version: 1;
  algorithm: "RSA-OAEP";
  hash: "SHA-256";
  keyId: string;
  publicKeySpki: string;
  privateKeyJwk: JsonWebKey;
  createdAt: number;
};

export type SharedEncryptedSharePublicKey = {
  recipientKeyId: string;
  publicKeySpki: string;
};

export type EncryptedShareKeyMismatch = {
  recipientKeyId: string;
  currentKeyId: string;
};

function resolveRecipientKeyId(
  recipient: Pick<StoredEncryptedShareKeyPair, "keyId"> | SharedEncryptedSharePublicKey
): string {
  if ("recipientKeyId" in recipient) {
    return recipient.recipientKeyId;
  }
  return recipient.keyId;
}

function normalizeBase64(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
}

function toBufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
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
    throw new Error(`Encrypted share ${name} must be a base64url string.`);
  }
  return value;
}

export function parseEncryptedSharePayload(value: unknown): EncryptedSharePayload {
  if (!value || typeof value !== "object") {
    throw new Error("Payload must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  if (record.version !== ENCRYPTED_SHARE_VERSION) {
    throw new Error(`Unsupported encrypted share version: ${String(record.version)}`);
  }
  if (record.alg !== ENCRYPTED_SHARE_ALGORITHM) {
    throw new Error(`Unsupported encrypted share algorithm: ${String(record.alg)}`);
  }

  const recipientKeyId =
    typeof record.recipientKeyId === "string" && KEY_ID_RE.test(record.recipientKeyId)
      ? record.recipientKeyId
      : null;
  if (!recipientKeyId) {
    throw new Error("Encrypted share recipientKeyId must be a compact string.");
  }

  const encryptedKey = expectBase64UrlField(record.encryptedKey, "encryptedKey");
  const iv = expectBase64UrlField(record.iv, "iv");
  const ciphertext = expectBase64UrlField(record.ciphertext, "ciphertext");
  const mac = expectBase64UrlField(record.mac, "mac");

  if (decodeBase64Url(iv).byteLength !== CBC_IV_BYTES) {
    throw new Error(`Encrypted share iv must decode to ${CBC_IV_BYTES} bytes.`);
  }
  if (decodeBase64Url(encryptedKey).byteLength === 0) {
    throw new Error("Encrypted share encryptedKey must not be empty.");
  }
  if (decodeBase64Url(ciphertext).byteLength === 0) {
    throw new Error("Encrypted share ciphertext must not be empty.");
  }
  if (decodeBase64Url(mac).byteLength !== HMAC_BYTES) {
    throw new Error(`Encrypted share mac must decode to ${HMAC_BYTES} bytes.`);
  }

  return {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    recipientKeyId,
    encryptedKey,
    iv,
    ciphertext,
    mac,
  };
}

function isStoredEncryptedShareKeyPair(value: unknown): value is StoredEncryptedShareKeyPair {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    record.algorithm === "RSA-OAEP" &&
    record.hash === "SHA-256" &&
    typeof record.keyId === "string" &&
    KEY_ID_RE.test(record.keyId) &&
    typeof record.publicKeySpki === "string" &&
    BASE64_URL_RE.test(record.publicKeySpki) &&
    typeof record.privateKeyJwk === "object" &&
    record.privateKeyJwk != null &&
    typeof record.createdAt === "number"
  );
}

export function readStoredEncryptedShareKeyPair(
  storage: Pick<Storage, "getItem">
): StoredEncryptedShareKeyPair | null {
  const raw = storage.getItem(ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isStoredEncryptedShareKeyPair(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredEncryptedShareKeyPair(
  storage: Pick<Storage, "setItem">,
  keyPair: StoredEncryptedShareKeyPair
): void {
  storage.setItem(ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY, JSON.stringify(keyPair));
}

async function createKeyId(publicKeySpki: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    toBufferSource(decodeBase64Url(publicKeySpki))
  );
  return encodeBase64Url(digest).slice(0, 16);
}

export async function generateEncryptedShareKeyPair(): Promise<StoredEncryptedShareKeyPair> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const publicKeySpki = encodeBase64Url(
    await globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey)
  );
  const keyId = await createKeyId(publicKeySpki);

  return {
    version: 1,
    algorithm: "RSA-OAEP",
    hash: "SHA-256",
    keyId,
    publicKeySpki,
    privateKeyJwk: await globalThis.crypto.subtle.exportKey("jwk", keyPair.privateKey),
    createdAt: Date.now(),
  };
}

async function importStoredPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

async function importPublicKeySpki(publicKeySpki: string): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "spki",
    toBufferSource(decodeBase64Url(publicKeySpki)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

async function importAesKey(rawKey: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(rawKey),
    { name: "AES-CBC" },
    false,
    [usage]
  );
}

async function importHmacKey(rawKey: Uint8Array, usage: "sign" | "verify"): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(rawKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

export async function decryptEncryptedShare(
  payloadInput: EncryptedSharePayload,
  keyPair: Pick<StoredEncryptedShareKeyPair, "keyId" | "privateKeyJwk">
): Promise<string> {
  const payload = parseEncryptedSharePayload(payloadInput);
  if (payload.recipientKeyId !== keyPair.keyId) {
    throw new Error("This document was encrypted for a different local key.");
  }

  const privateKey = await importStoredPrivateKey(keyPair.privateKeyJwk);
  const rawWrappedKey = new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      toBufferSource(decodeBase64Url(payload.encryptedKey))
    )
  );
  if (rawWrappedKey.byteLength !== WRAPPED_KEY_BYTES) {
    throw new Error(`Encrypted share wrapped key must decode to ${WRAPPED_KEY_BYTES} bytes.`);
  }

  const encryptionKeyBytes = rawWrappedKey.slice(0, AES_KEY_BYTES);
  const macKeyBytes = rawWrappedKey.slice(AES_KEY_BYTES);
  const iv = decodeBase64Url(payload.iv);
  const ciphertext = decodeBase64Url(payload.ciphertext);
  const mac = decodeBase64Url(payload.mac);
  const macKey = await importHmacKey(macKeyBytes, "sign");
  const computedMac = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      macKey,
      toBufferSource(concatBytes(iv, ciphertext))
    )
  );
  if (!equalBytes(computedMac, mac)) {
    throw new Error("Encrypted share MAC verification failed.");
  }

  const contentKey = await importAesKey(encryptionKeyBytes, "decrypt");
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: toBufferSource(iv) },
    contentKey,
    toBufferSource(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export function detectEncryptedShareKeyMismatch(
  payloadInput: EncryptedSharePayload,
  keyPair: Pick<StoredEncryptedShareKeyPair, "keyId">
): EncryptedShareKeyMismatch | null {
  const payload = parseEncryptedSharePayload(payloadInput);
  if (payload.recipientKeyId === keyPair.keyId) {
    return null;
  }
  return {
    recipientKeyId: payload.recipientKeyId,
    currentKeyId: keyPair.keyId,
  };
}

export async function createEncryptedSharePayload(
  plaintext: string,
  recipient:
    | Pick<StoredEncryptedShareKeyPair, "publicKeySpki" | "keyId">
    | SharedEncryptedSharePublicKey
): Promise<EncryptedSharePayload> {
  const publicKey = await importPublicKeySpki(recipient.publicKeySpki);
  const recipientKeyId = resolveRecipientKeyId(recipient);
  const encryptionKeyBytes = globalThis.crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  const macKeyBytes = globalThis.crypto.getRandomValues(new Uint8Array(HMAC_KEY_BYTES));
  const contentKey = await importAesKey(encryptionKeyBytes, "encrypt");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(CBC_IV_BYTES));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-CBC", iv: toBufferSource(iv) },
    contentKey,
    toBufferSource(new TextEncoder().encode(plaintext))
  );
  const macKey = await importHmacKey(macKeyBytes, "sign");
  const mac = await globalThis.crypto.subtle.sign(
    "HMAC",
    macKey,
    toBufferSource(concatBytes(iv, new Uint8Array(ciphertext)))
  );
  const encryptedKey = await globalThis.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    toBufferSource(concatBytes(encryptionKeyBytes, macKeyBytes))
  );

  return {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    recipientKeyId,
    encryptedKey: encodeBase64Url(encryptedKey),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
    mac: encodeBase64Url(mac),
  };
}

export function buildEncryptedShareAgentInstructions(args: {
  sessionId: string;
  baseUrl: string;
  publicKeyUrl: string;
}): string {
  const submitUrl = `${args.baseUrl}/share/${args.sessionId}`;
  return [
    "Use end-to-end encryption for this askhuman share session.",
    "",
    "Do these steps now. Use local openssl or libressl CLI. Do not rely on Node.",
    `Create a uniquely named temp directory for this session, for example using the session ID ${args.sessionId}.`,
    "Prefer writing a reusable helper script for this encryption flow and invoking it with session-specific inputs instead of pasting an inline shell script each round.",
    `1. Fetch the recipient public key JSON from ${args.publicKeyUrl}`,
    "   Read recipientKeyId and publicKeySpki from the JSON response.",
    "   Reuse the same recipient key across sessions until the user sends a different key ID or new copied instructions.",
    "2. Base64url-decode publicKeySpki to DER and convert it into an RSA public key that openssl can read.",
    "3. Generate a fresh 32-byte AES key, a fresh 32-byte HMAC key, and a fresh 16-byte IV.",
    "4. Encrypt the markdown document bytes with AES-256-CBC using that AES key and IV.",
    "5. Compute HMAC-SHA256 over iv || ciphertext using the HMAC key.",
    "6. Concatenate aesKey || hmacKey and encrypt that 64-byte blob with RSA-OAEP-SHA256 using the fetched public key.",
    "7. Base64url-encode encryptedKey, iv, ciphertext, and mac.",
    `8. POST only ciphertext JSON to ${submitUrl}`,
    `{"version":3,"alg":"rsa-oaep-256+aes-256-cbc+hmac-sha256","recipientKeyId":"...","encryptedKey":"...","iv":"...","ciphertext":"...","mac":"..."}`,
    "",
    "Never send plaintext or any private key material to the server.",
  ].join("\n");
}

export function buildEncryptedSessionErrorInstructions(args: {
  toolId: ToolId;
  sessionId: string;
  message: string;
  currentKeyId?: string | null;
}): string {
  const toolLabel =
    args.toolId === "share"
      ? "share"
      : args.toolId === "present"
        ? "present"
        : args.toolId === "playground"
          ? "playground"
          : args.toolId === "diff"
            ? "diff"
            : "review";
  return [
    `The encrypted ${toolLabel} session failed to decrypt in my browser.`,
    `Session ID: ${args.sessionId}`,
    `Error: ${args.message}`,
    ...(args.currentKeyId ? [`Current browser key ID: ${args.currentKeyId}`] : []),
    "Next step: rebuild the encrypted envelope for this session and POST it again.",
  ].join("\n");
}
