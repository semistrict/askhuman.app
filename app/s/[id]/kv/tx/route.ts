import { SessionDO, type KvTransactionOp } from "@/worker/session";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    baseVersion?: unknown;
    idempotencyKey?: unknown;
    ops?: unknown;
  };

  if (!Array.isArray(body.ops)) {
    return Response.json({ ok: false, error: "ops must be an array" }, { status: 400 });
  }

  const ops = body.ops as KvTransactionOp[];
  const session = SessionDO.getInstance(id);
  const result = await session.executeKvTransaction({
    baseVersion:
      typeof body.baseVersion === "number" && Number.isInteger(body.baseVersion)
        ? body.baseVersion
        : null,
    idempotencyKey:
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : null,
    ops,
  });

  if (!result.ok) {
    return Response.json(result, { status: result.reason === "version_conflict" ? 409 : 412 });
  }
  return Response.json(result);
}
