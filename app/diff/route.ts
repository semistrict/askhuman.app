import { createSession } from "@/lib/plan-review";
import {
  createDiffSession,
  updateDiffSession,
  parseFormData,
  RequestHunksValidationError,
} from "@/lib/diff-review";
import { msg } from "@/lib/agent-messages";
import {
  diffSubmitMarkdown,
  diffUpdateMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const formData = await request.formData();
    const { description, diff, sessionId: existingSessionId, skipLengthCheck } = await parseFormData(formData);

    if (existingSessionId) {
      const result = await updateDiffSession(existingSessionId, description, diff, baseUrl, skipLengthCheck);
      return negotiatedResponse(request, result, diffUpdateMarkdown(result));
    }

    const id = createSession();
    const result = await createDiffSession(id, description, diff, baseUrl, skipLengthCheck);
    return negotiatedResponse(request, result, diffSubmitMarkdown(result));
  } catch (error) {
    if (error instanceof RequestHunksValidationError) {
      const payload = { error: error.message };
      return negotiatedResponse(
        request,
        payload,
        errorMarkdown(payload.error),
        { status: error.status }
      );
    }
    throw error;
  }
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
