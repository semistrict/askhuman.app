import startHandler from "@tanstack/react-start/server-entry";
import type { AppCloudflareEnv } from "@/lib/cloudflare-env";
import { buildRootPlainText, detectRootPlainRecipe } from "@/lib/root-plain";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
} as const;
const LEGACY_ENDPOINTS = new Set([
  "/review",
  "/diff",
  "/present",
  "/playground",
  "/share",
  "/plan",
  "/files",
  "/remark",
]);

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function plainTextResponse(value: string): Response {
  return withSecurityHeaders(
    new Response(value.endsWith("\n") ? value : `${value}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

function shouldServePlainRoot(request: Request): boolean {
  const userAgent = request.headers.get("user-agent") || "";
  const signatureAgent = request.headers.get("signature-agent") || "";

  if (/^curl\//i.test(userAgent)) return true;
  if (detectRootPlainRecipe(request) === "powershell") return true;
  if (signatureAgent.trim() === "https://chatgpt.com") return true;
  if (/\bClaude-User\b/i.test(userAgent)) return true;
  if (/\bChatGPT-User\b/i.test(userAgent)) return true;

  return false;
}

function isCurlRequest(request: Request): boolean {
  return /^curl\//i.test(request.headers.get("user-agent") || "");
}

function handleRootPlain(request: Request): Response {
  const base = new URL("/", request.url).toString().replace(/\/$/, "");
  const text = buildRootPlainText(base, { recipe: detectRootPlainRecipe(request) });
  return plainTextResponse(text);
}

function handleShareCurl(): Response {
  return plainTextResponse(
    [
      "This encrypted viewer URL is meant for the human's browser, not curl.",
      "",
      "Give the full URL, including its #k= fragment, to the human.",
      "The fragment contains the decryption key and is never sent to askhuman.app.",
      "",
    ].join("\n")
  );
}

function isLegacyEndpoint(pathname: string): boolean {
  return LEGACY_ENDPOINTS.has(pathname) || pathname.startsWith("/k/");
}

export default {
  async fetch(
    request: Request,
    env: AppCloudflareEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    void env;
    void ctx;
    const url = new URL(request.url);

    if (url.pathname === "/llms.txt" && request.method === "GET") {
      return handleRootPlain(request);
    }

    if (url.pathname === "/" && request.method === "GET" && shouldServePlainRoot(request)) {
      return handleRootPlain(request);
    }

    if (url.pathname.startsWith("/s/") && request.method === "GET" && isCurlRequest(request)) {
      return handleShareCurl();
    }

    if (request.method === "POST" && isLegacyEndpoint(url.pathname)) {
      return withSecurityHeaders(new Response("Not found\n", { status: 404 }));
    }

    return withSecurityHeaders(await startHandler.fetch(request));
  },
};
