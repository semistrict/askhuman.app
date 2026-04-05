import { submitPlan } from "@/lib/plan-review";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const markdown = await request.text();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await submitPlan(id, markdown, baseUrl);
  return Response.json(result);
}
