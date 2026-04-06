import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const { hunkId, line, text } = (await request.json()) as { hunkId?: number; line?: number; text: string };
  const thread = await session.createThread(line ?? null, text, hunkId ?? null);
  return Response.json(thread);
}
