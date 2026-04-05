import { PlanSession } from "@/worker/plan-session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = PlanSession.getInstance(id);
  const code = await request.text();
  await session.broadcastEval(code);
  return Response.json({ ok: true });
}
