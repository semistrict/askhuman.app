import { McpSession } from "@/worker/mcp-session";

function forwardToStub(
  sessionName: string,
  request: Request,
  extraHeaders?: Record<string, string>
) {
  const stub = McpSession.getInstance(sessionName);
  const headers = new Headers(request.headers);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return stub.fetch(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit);
}

export async function POST(request: Request) {
  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    return forwardToStub(sessionId, request);
  }
  // New session — create a DO and pass the session name via header
  const id = crypto.randomUUID();
  return forwardToStub(id, request, { "x-mcp-session-name": id });
}

export async function GET(request: Request) {
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response("Missing Mcp-Session-Id header", { status: 400 });
  }
  return forwardToStub(sessionId, request);
}

export async function DELETE(request: Request) {
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response("Missing Mcp-Session-Id header", { status: 400 });
  }
  return forwardToStub(sessionId, request);
}
