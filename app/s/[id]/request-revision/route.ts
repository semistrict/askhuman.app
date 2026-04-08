import { requestDocRevision } from "@/lib/plan-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await requestDocRevision(id, baseUrl);
  return Response.json(result);
}
