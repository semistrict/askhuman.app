import { SessionDO } from "@/worker/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const url = new URL(request.url);
  url.pathname = `/s/${id}/kv/ws`;
  return session.fetch(url.toString(), {
    headers: request.headers,
  });
}
