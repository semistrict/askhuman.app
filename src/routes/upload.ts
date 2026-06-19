import { createFileRoute } from "@tanstack/react-router";
import { createCompactId } from "@/lib/compact-id";
import {
  ENCRYPTED_HTML_TTL_SECONDS,
  formatByteSize,
  MAX_UPLOAD_FORM_BYTES,
  parseEncryptedHtmlPayload,
} from "@/lib/encrypted-html";
import {
  createUploadActorKey,
  estimateUploadBytes,
  reserveClientUploadQuota,
  UPLOAD_ATTEMPT_RATE_LIMIT,
} from "@/lib/upload-limits";

type ErrorBody = { error: string };

const ALLOWED_FIELDS = new Set([
  "version",
  "alg",
  "compression",
  "title",
  "filename",
  "iv",
  "ciphertext",
  "mac",
]);
const FORBIDDEN_FIELDS = new Set(["key", "html", "plaintext", "content"]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
};

function wantsJson(request: Request): boolean {
  return /\bapplication\/json\b/i.test(request.headers.get("accept") || "");
}

function headersWithCors(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    result.set(name, value);
  }
  return result;
}

function textResponse(value: string, init?: ResponseInit): Response {
  return new Response(value.endsWith("\n") ? value : `${value}\n`, {
    ...init,
    headers: headersWithCors({
      ...Object.fromEntries(new Headers(init?.headers)),
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}

function errorResponse(
  request: Request,
  message: string,
  status: number,
  headers?: HeadersInit
): Response {
  const body: ErrorBody = { error: message };
  if (wantsJson(request)) {
    return Response.json(body, {
      status,
      headers: headersWithCors(headers),
    });
  }
  return textResponse(`Error: ${message}`, { status, headers });
}

function readContentLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

async function enforceUploadAttemptRateLimit(actorKey: string): Promise<boolean> {
  const { appEnv } = await import("@/lib/cloudflare-env");
  const limiter = appEnv.UPLOAD_RATE_LIMITER;
  if (!limiter) return true;

  const { success } = await limiter.limit({ key: `upload:${actorKey}` });
  return success;
}

async function formValueToString(value: FormDataEntryValue, name: string): Promise<string> {
  if (typeof value === "string") {
    const size = new TextEncoder().encode(value).byteLength;
    if (size > MAX_UPLOAD_FORM_BYTES) {
      throw new Error(
        `${name} is too large: ${formatByteSize(size)} (${size.toLocaleString()} bytes). Limit: ${formatByteSize(MAX_UPLOAD_FORM_BYTES)} (${MAX_UPLOAD_FORM_BYTES.toLocaleString()} bytes).`
      );
    }
    return value.trim();
  }

  const text = await value.text();
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_UPLOAD_FORM_BYTES) {
    throw new Error(
      `${name} is too large: ${formatByteSize(size)} (${size.toLocaleString()} bytes). Limit: ${formatByteSize(MAX_UPLOAD_FORM_BYTES)} (${MAX_UPLOAD_FORM_BYTES.toLocaleString()} bytes).`
    );
  }
  return text.trim();
}

async function formDataToPayloadInput(formData: FormData): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  for (const name of FORBIDDEN_FIELDS) {
    if (formData.has(name)) {
      throw new Error("Upload only encrypted payload fields; never include plaintext or keys.");
    }
  }

  for (const name of formData.keys()) {
    if (!ALLOWED_FIELDS.has(name)) {
      throw new Error(`Unsupported upload field: ${name}`);
    }
    if (formData.getAll(name).length > 1) {
      throw new Error(`Upload field ${name} must appear only once.`);
    }
  }

  for (const name of ALLOWED_FIELDS) {
    const value = formData.get(name);
    if (value === null) continue;
    const stringValue = await formValueToString(value, name);
    if (!stringValue && (name === "title" || name === "filename")) continue;
    result[name] = name === "version" ? Number(stringValue) : stringValue;
  }

  return result;
}

async function handleUploadPost(request: Request) {
  const { appEnv } = await import("@/lib/cloudflare-env");
  const contentType = request.headers.get("content-type") || "";
  if (!/\bmultipart\/form-data\b/i.test(contentType)) {
    return errorResponse(request, "Upload encrypted fields with multipart/form-data.", 415);
  }

  const contentLength = readContentLength(request);
  if (contentLength !== null && contentLength > MAX_UPLOAD_FORM_BYTES) {
    return errorResponse(
      request,
      `Encrypted upload is too large: ${formatByteSize(contentLength)} (${contentLength.toLocaleString()} bytes). Limit: ${formatByteSize(MAX_UPLOAD_FORM_BYTES)} (${MAX_UPLOAD_FORM_BYTES.toLocaleString()} bytes).`,
      413
    );
  }

  const actorKey = await createUploadActorKey(request);
  const underAttemptLimit = await enforceUploadAttemptRateLimit(actorKey);
  if (!underAttemptLimit) {
    return errorResponse(request, "Too many upload attempts. Try again soon.", 429, {
      "Retry-After": String(UPLOAD_ATTEMPT_RATE_LIMIT.periodSeconds),
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(request, "Could not read request body.", 400);
  }

  let parsed: unknown;
  try {
    parsed = await formDataToPayloadInput(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Encrypted multipart form is invalid.";
    return errorResponse(request, message, 400);
  }

  let payload;
  try {
    payload = parseEncryptedHtmlPayload(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Encrypted HTML payload is invalid.";
    return errorResponse(request, message, 400);
  }

  const quota = await reserveClientUploadQuota(
    appEnv.SHARE_KEYS,
    actorKey,
    estimateUploadBytes(payload, contentLength)
  );
  if (!quota.allowed) {
    return errorResponse(request, quota.message, 429, {
      "Retry-After": String(quota.retryAfterSeconds),
    });
  }

  const id = createCompactId(11);
  await appEnv.SHARE_KEYS.put(id, JSON.stringify(payload), {
    expirationTtl: ENCRYPTED_HTML_TTL_SECONDS,
  });

  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const url = `${baseUrl}/s/${id}`;

  if (wantsJson(request)) {
    return Response.json(
      { id, url, expiresInSeconds: ENCRYPTED_HTML_TTL_SECONDS },
      {
        headers: headersWithCors(),
      }
    );
  }

  return textResponse(url);
}

export const Route = createFileRoute("/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => handleUploadPost(request),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            ...CORS_HEADERS,
            "Cache-Control": "no-store",
          },
        }),
      GET: async ({ request }) =>
        errorResponse(request, "Use POST /upload with encrypted multipart form fields.", 405),
    },
  },
});
