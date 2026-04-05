import { PlanSession } from "@/worker/plan-session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = PlanSession.getInstance(id);
  const { line, text } = (await request.json()) as { line?: number; text: string };
  const thread = await session.createThread(line ?? null, text);
  return Response.json(thread);
}
