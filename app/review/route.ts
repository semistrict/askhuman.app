import { createSession } from "@/lib/plan-review";
import {
  createFileSession,
  updateFileSession,
  parseFileSubmissionRequest,
  FileReviewError,
} from "@/lib/file-review";
import { msg } from "@/lib/agent-messages";
import {
  fileSubmitMarkdown,
  fileUpdateMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const { files, sessionId: existingSessionId, response } =
      await parseFileSubmissionRequest(request);

    if (existingSessionId) {
      const result = await updateFileSession(existingSessionId, files, baseUrl, response);
      return negotiatedResponse(request, result, fileUpdateMarkdown(result));
    }

    const id = createSession();
    const result = await createFileSession(id, files, baseUrl);
    return negotiatedResponse(request, result, fileSubmitMarkdown(result));
  } catch (error) {
    if (error instanceof FileReviewError) {
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
  const error = { error: msg("route_review_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
