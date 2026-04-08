import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  if ((await session.getContentType()) === "plan") {
    await session.completeDocReview();
  } else {
    await session.markDone();
  }
  return Response.json({ ok: true, done: true });
}
