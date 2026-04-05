import { createSession, submitPlan } from "@/lib/plan-review";

export async function POST(request: Request) {
  const id = createSession();
  const markdown = await request.text();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await submitPlan(id, markdown, baseUrl);
  return Response.json(result);
}
