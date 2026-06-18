import { encodeBase64Url, type EncryptedHtmlPayload } from "@/lib/encrypted-html";

export const UPLOAD_ATTEMPT_RATE_LIMIT = {
  limit: 20,
  periodSeconds: 60,
} as const;

export const CLIENT_UPLOAD_WINDOW_SECONDS = 24 * 60 * 60;
export const CLIENT_UPLOAD_COUNT_LIMIT = 100;
export const CLIENT_UPLOAD_BYTES_LIMIT = 100 * 1024 * 1024;

type UploadLedger = {
  count: number;
  bytes: number;
};

type UploadLedgerStore = {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
};

export type UploadQuotaDecision =
  | {
      allowed: true;
      count: number;
      bytes: number;
      resetAt: number;
    }
  | {
      allowed: false;
      message: string;
      retryAfterSeconds: number;
      resetAt: number;
    };

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function normalizeActorInput(value: string): string {
  return value.trim().toLowerCase();
}

function uploadWindowBucket(now: number): number {
  return Math.floor(now / (CLIENT_UPLOAD_WINDOW_SECONDS * 1000));
}

function uploadWindowResetAt(now: number): number {
  return (uploadWindowBucket(now) + 1) * CLIENT_UPLOAD_WINDOW_SECONDS * 1000;
}

function quotaKey(actorKey: string, now: number): string {
  return `upload-quota:v1:${uploadWindowBucket(now)}:${actorKey}`;
}

function isUploadLedger(value: unknown): value is UploadLedger {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as UploadLedger).count === "number" &&
    typeof (value as UploadLedger).bytes === "number"
  );
}

function readLedger(value: unknown): UploadLedger {
  if (!isUploadLedger(value)) {
    return { count: 0, bytes: 0 };
  }
  return {
    count: Math.max(0, Math.floor(value.count)),
    bytes: Math.max(0, Math.floor(value.bytes)),
  };
}

export function getDetectedClientIp(request: Request): string {
  return (
    firstHeaderValue(request.headers.get("cf-connecting-ip")) ||
    firstHeaderValue(request.headers.get("x-forwarded-for")) ||
    firstHeaderValue(request.headers.get("x-real-ip")) ||
    "dev-local"
  );
}

export async function createUploadActorKey(request: Request): Promise<string> {
  const actorInput = `ip:${normalizeActorInput(getDetectedClientIp(request))}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorInput));
  return encodeBase64Url(digest).slice(0, 43);
}

export function estimateUploadBytes(
  payload: EncryptedHtmlPayload,
  contentLength: number | null
): number {
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > 0) {
    return Math.ceil(contentLength);
  }

  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

export async function reserveClientUploadQuota(
  store: UploadLedgerStore,
  actorKey: string,
  uploadBytes: number,
  now = Date.now()
): Promise<UploadQuotaDecision> {
  const resetAt = uploadWindowResetAt(now);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  const key = quotaKey(actorKey, now);
  const ledger = readLedger(await store.get<UploadLedger>(key, "json"));
  const next = {
    count: ledger.count + 1,
    bytes: ledger.bytes + Math.max(0, Math.ceil(uploadBytes)),
  };

  if (next.count > CLIENT_UPLOAD_COUNT_LIMIT) {
    return {
      allowed: false,
      message: "Daily upload count limit exceeded for this client.",
      retryAfterSeconds,
      resetAt,
    };
  }

  if (next.bytes > CLIENT_UPLOAD_BYTES_LIMIT) {
    return {
      allowed: false,
      message: "Daily upload size limit exceeded for this client.",
      retryAfterSeconds,
      resetAt,
    };
  }

  await store.put(key, JSON.stringify(next), {
    expirationTtl: CLIENT_UPLOAD_WINDOW_SECONDS + 5 * 60,
  });

  return {
    allowed: true,
    count: next.count,
    bytes: next.bytes,
    resetAt,
  };
}
