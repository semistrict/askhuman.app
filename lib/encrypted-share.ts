export const ENCRYPTED_SHARE_VERSION = 2 as const;
export const ENCRYPTED_SHARE_ALGORITHM = "rsa-oaep-256+aes-256-gcm" as const;
export const ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY = "askhuman.encrypted-share.keypair";

const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

export type EncryptedSharePayload = {
  version: typeof ENCRYPTED_SHARE_VERSION;
  alg: typeof ENCRYPTED_SHARE_ALGORITHM;
  recipientKeyId: string;
  encryptedKey: string;
  iv: string;
  ciphertext: string;
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

  if (decodeBase64Url(iv).byteLength !== 12) {
    throw new Error("Encrypted share iv must decode to 12 bytes.");
  }
  if (decodeBase64Url(encryptedKey).byteLength === 0) {
    throw new Error("Encrypted share encryptedKey must not be empty.");
  }
  if (decodeBase64Url(ciphertext).byteLength === 0) {
    throw new Error("Encrypted share ciphertext must not be empty.");
  }

  return {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    recipientKeyId,
    encryptedKey,
    iv,
    ciphertext,
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

export async function decryptEncryptedShare(
  payloadInput: EncryptedSharePayload,
  keyPair: Pick<StoredEncryptedShareKeyPair, "keyId" | "privateKeyJwk">
): Promise<string> {
  const payload = parseEncryptedSharePayload(payloadInput);
  if (payload.recipientKeyId !== keyPair.keyId) {
    throw new Error("This document was encrypted for a different local key.");
  }

  const privateKey = await importStoredPrivateKey(keyPair.privateKeyJwk);
  const rawContentKey = await globalThis.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    toBufferSource(decodeBase64Url(payload.encryptedKey))
  );
  const contentKey = await globalThis.crypto.subtle.importKey(
    "raw",
    rawContentKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBufferSource(decodeBase64Url(payload.iv)) },
    contentKey,
    toBufferSource(decodeBase64Url(payload.ciphertext))
  );
  return new TextDecoder().decode(plaintext);
}

export async function createEncryptedSharePayload(
  plaintext: string,
  recipient:
    | Pick<StoredEncryptedShareKeyPair, "publicKeySpki" | "keyId">
    | SharedEncryptedSharePublicKey
): Promise<EncryptedSharePayload> {
  const publicKey = await importPublicKeySpki(recipient.publicKeySpki);
  const recipientKeyId = resolveRecipientKeyId(recipient);
  const contentKey = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv) },
    contentKey,
    toBufferSource(new TextEncoder().encode(plaintext))
  );
  const rawContentKey = await globalThis.crypto.subtle.exportKey("raw", contentKey);
  const encryptedKey = await globalThis.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    rawContentKey
  );

  return {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    recipientKeyId,
    encryptedKey: encodeBase64Url(encryptedKey),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

export function buildEncryptedShareAgentInstructions(args: {
  sessionId: string;
  baseUrl: string;
  publicKeyUrl: string;
}): string {
  const submitUrl = `${args.baseUrl}/share/${args.sessionId}`;
  return [
    "Use end-to-end encryption for my askhuman share session.",
    "",
    `1. Fetch the recipient public key JSON from ${args.publicKeyUrl}`,
    "   It returns recipientKeyId and publicKeySpki. This short-lived URL expires after 24 hours.",
    "2. Encrypt the markdown document with a fresh AES-256-GCM content key and a fresh 12-byte IV.",
    "3. Encrypt that content key with RSA-OAEP-SHA256 using the fetched public key.",
    `4. POST only ciphertext JSON to ${submitUrl} in this exact shape:`,
    `{"version":2,"alg":"rsa-oaep-256+aes-256-gcm","recipientKeyId":"...","encryptedKey":"...","iv":"...","ciphertext":"..."}`,
    "",
    "Never send plaintext or any private key material to the server.",
  ].join("\n");
}
