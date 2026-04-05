import { pollComments } from "@/lib/plan-review";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const timeoutHeader = request.headers.get("X-Poll-Timeout");
  const timeoutMs = timeoutHeader ? Number(timeoutHeader) : 120000;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await pollComments(id, timeoutMs, baseUrl);
  return Response.json(result);
}
