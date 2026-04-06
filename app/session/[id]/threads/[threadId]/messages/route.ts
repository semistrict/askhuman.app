import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id, threadId } = await params;
  const session = SessionDO.getInstance(id);
  const { text } = (await request.json()) as { text: string };
  const message = await session.addMessage(Number(threadId), "human", text);
  return Response.json(message);
}
