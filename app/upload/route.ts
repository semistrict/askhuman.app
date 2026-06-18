import { env } from "cloudflare:workers";
import { createCompactId } from "@/lib/compact-id";
import {
  ENCRYPTED_HTML_TTL_SECONDS,
  MAX_UPLOAD_JSON_BYTES,
  parseEncryptedHtmlPayload,
} from "@/lib/encrypted-html";

type ErrorBody = { error: string };

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/\bapplication\/json\b/i.test(contentType)) {
    return errorResponse(request, "Upload encrypted-html.json with Content-Type: application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_JSON_BYTES) {
    return errorResponse(request, "Encrypted upload is too large.", 413);
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return errorResponse(request, "Could not read request body.", 400);
  }
  if (!raw.trim()) {
    return errorResponse(request, "Upload body must not be empty.", 400);
  }
  if (raw.length > MAX_UPLOAD_JSON_BYTES) {
    return errorResponse(request, "Encrypted upload is too large.", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse(request, "Upload body must be valid JSON.", 400);
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
  return errorResponse(request, "Use POST /upload with encrypted HTML JSON.", 405);
}
