import { createSession } from "@/lib/plan-review";
import { submitDiff } from "@/lib/diff-review";
import { msg } from "@/lib/agent-messages";
import {
  diffSubmitMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const body = await request.text();
  if (body.trim() !== "") {
    const error = { error: msg("route_diff_nonempty_body") };
    return negotiatedResponse(
      request,
      error,
      errorMarkdown(error.error),
      { status: 400 }
    );
  }

  const id = createSession();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await submitDiff(id, baseUrl);
  return negotiatedResponse(request, result, diffSubmitMarkdown(result));
}

export async function GET(request: Request) {
  const error = { error: msg("route_diff_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
