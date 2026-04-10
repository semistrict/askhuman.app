import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const value = await env.SHARE_KEYS.get(id, "text");
  if (!value) {
    return Response.json({ error: "Key not found or expired." }, { status: 404 });
  }

  return new Response(value, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
