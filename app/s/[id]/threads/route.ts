import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const { hunkId, line, text, filePath } = (await request.json()) as {
    hunkId?: string;
    line?: number;
    text: string;
    filePath?: string;
  };
  const thread = await session.createThread(
    line ?? null,
    text,
    hunkId ?? null,
    filePath ?? null
  );
  return Response.json(thread);
}
