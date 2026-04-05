import { PlanSession } from "@/worker/plan-session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const { id } = await params;
  const session = PlanSession.getInstance(id);
  // Forward WebSocket upgrade to DO — construct a fresh Request with the upgrade headers
  const url = new URL(request.url);
  return session.fetch(url.toString(), {
    headers: request.headers,
  });
}
