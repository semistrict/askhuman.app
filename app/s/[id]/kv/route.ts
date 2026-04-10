import { SessionDO } from "@/worker/session";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const prefix = url.searchParams.get("prefix");
  const after = url.searchParams.get("after");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const session = SessionDO.getInstance(id);

  if (key) {
    const entry = await session.getKvEntry(key);
    return Response.json({
      ok: true,
      version: await session.getKvVersion(),
      entry,
    });
  }

  const entries = await session.scanKv(prefix ?? "", after, Number.isFinite(limit) ? limit : 100);
  return Response.json({
    ok: true,
    version: await session.getKvVersion(),
    entries,
  });
}
