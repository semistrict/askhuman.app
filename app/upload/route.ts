import { env } from "cloudflare:workers";
import { createCompactId } from "@/lib/compact-id";
import {
  ENCRYPTED_HTML_TTL_SECONDS,
  MAX_UPLOAD_FORM_BYTES,
  parseEncryptedHtmlPayload,
} from "@/lib/encrypted-html";

type ErrorBody = { error: string };

export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set(["version", "alg", "title", "filename", "iv", "ciphertext", "mac"]);
const FORBIDDEN_FIELDS = new Set(["key", "html", "plaintext", "content"]);

function wantsJson(request: Request): boolean {
  return /\bapplication\/json\b/i.test(request.headers.get("accept") || "");
}

function textResponse(value: string, init?: ResponseInit): Response {
  return new Response(value.endsWith("\n") ? value : `${value}\n`, {
    ...init,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });
}

function errorResponse(request: Request, message: string, status: number): Response {
  const body: ErrorBody = { error: message };
  if (wantsJson(request)) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
  return textResponse(`Error: ${message}`, { status });
}

async function formValueToString(value: FormDataEntryValue, name: string): Promise<string> {
  if (typeof value === "string") {
    return value.trim();
  }

  const text = await value.text();
  if (text.length > MAX_UPLOAD_FORM_BYTES) {
    throw new Error(`${name} is too large.`);
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

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/\bmultipart\/form-data\b/i.test(contentType)) {
    return errorResponse(request, "Upload encrypted fields with multipart/form-data.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_FORM_BYTES) {
    return errorResponse(request, "Encrypted upload is too large.", 413);
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

  const id = createCompactId(11);
  await env.SHARE_KEYS.put(id, JSON.stringify(payload), {
    expirationTtl: ENCRYPTED_HTML_TTL_SECONDS,
  });

  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const url = `${baseUrl}/s/${id}`;

  if (wantsJson(request)) {
    return Response.json(
      { id, url, expiresInSeconds: ENCRYPTED_HTML_TTL_SECONDS },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return textResponse(url);
}

export async function GET(request: Request) {
  return errorResponse(request, "Use POST /upload with encrypted multipart form fields.", 405);
}
