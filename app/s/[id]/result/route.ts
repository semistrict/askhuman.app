import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const body = await request.text();
  await session.setResult(body);
  return Response.json({ ok: true });
}
