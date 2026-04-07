import { createSession, submitPlan } from "@/lib/plan-review";
import { msg } from "@/lib/agent-messages";
import {
  errorMarkdown,
  negotiatedResponse,
  planSubmitMarkdown,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const id = createSession();
  const markdown = await request.text();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await submitPlan(id, markdown, baseUrl);
  return negotiatedResponse(request, result, planSubmitMarkdown(result));
}

export async function GET(request: Request) {
  const error = { error: msg("route_plan_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
