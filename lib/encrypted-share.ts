export const ENCRYPTED_SHARE_VERSION = 1 as const;
export const ENCRYPTED_SHARE_ALGORITHM = "aes-256-cbc+hmac-sha256" as const;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX_RE = /^[0-9a-f]+$/i;

export type EncryptedSharePayload = {
  version: typeof ENCRYPTED_SHARE_VERSION;
  alg: typeof ENCRYPTED_SHARE_ALGORITHM;
  iv: string;
  ciphertext: string;
  mac: string;
};

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

  const iv = expectBase64UrlField(record.iv, "iv");
  const ciphertext = expectBase64UrlField(record.ciphertext, "ciphertext");
  const mac = expectBase64UrlField(record.mac, "mac");

  if (decodeBase64Url(iv).byteLength !== 16) {
    throw new Error("Encrypted share iv must decode to 16 bytes.");
  }
  if (decodeBase64Url(mac).byteLength !== 32) {
    throw new Error("Encrypted share mac must decode to 32 bytes.");
  }
  if (decodeBase64Url(ciphertext).byteLength === 0) {
    throw new Error("Encrypted share ciphertext must not be empty.");
  }

  return {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    iv,
    ciphertext,
    mac,
  };
}

function expectBase64UrlField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || !BASE64_URL_RE.test(value)) {
    throw new Error(`Encrypted share ${name} must be a base64url string.`);
  }
  return value;
}

function normalizeBase64(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
}

function toBufferSource(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

export function decodeBase64Url(value: string): Uint8Array {
  const binary = globalThis.atob(normalizeBase64(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeHex(value: string): Uint8Array {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0 || !HEX_RE.test(trimmed)) {
    throw new Error("Expected an even-length hex string.");
  }
  const bytes = new Uint8Array(trimmed.length / 2);
  for (let index = 0; index < trimmed.length; index += 2) {
    bytes[index / 2] = Number.parseInt(trimmed.slice(index, index + 2), 16);
  }
  return bytes;
}

export function parseEncryptedShareKey(value: string): Uint8Array {
  const trimmed = value.trim();
  const bytes = HEX_RE.test(trimmed) ? decodeHex(trimmed) : decodeBase64Url(trimmed);
  if (bytes.byteLength !== 64) {
    throw new Error("Encrypted share key must decode to 64 bytes.");
  }
  return bytes;
}

export function encryptedShareKeyFromHash(hash: string): Uint8Array | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const raw = params.get("key");
  if (!raw) return null;
  return parseEncryptedShareKey(raw);
}

function splitKey(masterKey: Uint8Array): { encryptionKey: Uint8Array; macKey: Uint8Array } {
  if (masterKey.byteLength !== 64) {
    throw new Error("Encrypted share master key must be 64 bytes.");
  }
  return {
    encryptionKey: masterKey.slice(0, 32),
    macKey: masterKey.slice(32),
  };
}

function buildMacMessage(payload: Pick<EncryptedSharePayload, "version" | "alg" | "iv" | "ciphertext">): Uint8Array {
  return new TextEncoder().encode(
    `${payload.alg}:${payload.version}:${payload.iv}:${payload.ciphertext}`
  );
}

export async function decryptEncryptedShare(
  payloadInput: EncryptedSharePayload,
  masterKey: Uint8Array
): Promise<string> {
  const payload = parseEncryptedSharePayload(payloadInput);
  const { encryptionKey, macKey } = splitKey(masterKey);
  const subtle = globalThis.crypto.subtle;
  const macCryptoKey = await subtle.importKey(
    "raw",
    toBufferSource(macKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await subtle.verify(
    "HMAC",
    macCryptoKey,
    toBufferSource(decodeBase64Url(payload.mac)),
    toBufferSource(buildMacMessage(payload))
  );
  if (!verified) {
    throw new Error("Encrypted share integrity check failed.");
  }

  const encryptionCryptoKey = await subtle.importKey(
    "raw",
    toBufferSource(encryptionKey),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const plaintext = await subtle.decrypt(
    { name: "AES-CBC", iv: toBufferSource(decodeBase64Url(payload.iv)) },
    encryptionCryptoKey,
    toBufferSource(decodeBase64Url(payload.ciphertext))
  );
  return new TextDecoder().decode(plaintext);
}

export async function createEncryptedSharePayload(
  plaintext: string,
  masterKey: Uint8Array,
  iv: Uint8Array
): Promise<EncryptedSharePayload> {
  if (iv.byteLength !== 16) {
    throw new Error("Encrypted share iv must be 16 bytes.");
  }

  const { encryptionKey, macKey } = splitKey(masterKey);
  const subtle = globalThis.crypto.subtle;
  const encryptionCryptoKey = await subtle.importKey(
    "raw",
    toBufferSource(encryptionKey),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const ciphertext = await subtle.encrypt(
    { name: "AES-CBC", iv: toBufferSource(iv) },
    encryptionCryptoKey,
    toBufferSource(new TextEncoder().encode(plaintext))
  );
  const payload = {
    version: ENCRYPTED_SHARE_VERSION,
    alg: ENCRYPTED_SHARE_ALGORITHM,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
  };
  const macCryptoKey = await subtle.importKey(
    "raw",
    toBufferSource(macKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await subtle.sign("HMAC", macCryptoKey, toBufferSource(buildMacMessage(payload)));
  return {
    ...payload,
    mac: encodeBase64Url(mac),
  };
}
