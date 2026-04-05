import { PlanSession } from "@/worker/plan-session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id, threadId } = await params;
  const session = PlanSession.getInstance(id);
  const text = await request.text();
  const message = await session.addMessage(Number(threadId), "agent", text);
  return Response.json(message);
}
