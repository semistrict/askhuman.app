import { createSession } from "@/lib/plan-review";
import { submitDiff } from "@/lib/diff-review";
import {
  diffSubmitMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const id = createSession();
  const diff = await request.text();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await submitDiff(id, diff, baseUrl);
  return negotiatedResponse(request, result, diffSubmitMarkdown(result));
}

export async function GET(request: Request) {
  const error = { error: "POST a diff body to create a diff review session" };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
