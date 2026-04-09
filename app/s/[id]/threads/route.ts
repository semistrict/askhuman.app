import { SessionDO } from "@/worker/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = SessionDO.getInstance(id);
  const { hunkId, line, text, filePath, locationLabel, selectionText, selectionContext } = (await request.json()) as {
    hunkId?: string;
    line?: number;
    text: string;
    filePath?: string;
    locationLabel?: string;
    selectionText?: string;
    selectionContext?: string;
  };
  const thread = await session.createThread(
    line ?? null,
    text,
    hunkId ?? null,
    filePath ?? null,
    {
      locationLabel: locationLabel ?? null,
      selectionText: selectionText ?? null,
      selectionContext: selectionContext ?? null,
    }
  );
  return Response.json(thread);
}
