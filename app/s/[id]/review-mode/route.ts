import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { mode?: unknown };

  if (body.mode !== "doc" && body.mode !== "files") {
    return Response.json({ error: "mode must be 'doc' or 'files'" }, { status: 400 });
  }

  const session = SessionDO.getInstance(id);
  await session.setReviewMode(body.mode);
  if (body.mode === "doc") {
    await session.setDocReviewState("ready");
  }

  return Response.json({ ok: true, mode: body.mode });
}
