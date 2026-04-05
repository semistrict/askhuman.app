import { replyToComments } from "@/lib/plan-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    replies: { threadId: number; text: string }[];
  };
  const timeoutHeader = request.headers.get("X-Poll-Timeout");
  const timeoutMs = timeoutHeader ? Number(timeoutHeader) : 120000;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await replyToComments(id, body.replies, timeoutMs, baseUrl);
  return Response.json(result);
}
