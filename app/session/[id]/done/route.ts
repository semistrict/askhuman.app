import { PlanSession } from "@/worker/plan-session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = PlanSession.getInstance(id);
  await session.markDone();
  return Response.json({ ok: true });
}
