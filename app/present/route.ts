import { createSession } from "@/lib/plan-review";
import { msg } from "@/lib/agent-messages";
import {
  errorMarkdown,
  negotiatedResponse,
  presentSubmitMarkdown,
  presentUpdateMarkdown,
} from "@/lib/rest-response";
import {
  createPresentationSession,
  parsePresentationRequest,
  PresentError,
  updatePresentationSession,
} from "@/lib/present";

export async function POST(request: Request) {
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
      const { markdown, sessionId } = await parsePresentationRequest(request);
    if (sessionId) {
      const result = await updatePresentationSession(sessionId, markdown, baseUrl);
      return negotiatedResponse(request, result, presentUpdateMarkdown(result));
    }

    const id = createSession();
    const result = await createPresentationSession(id, markdown, baseUrl);
    return negotiatedResponse(request, result, presentSubmitMarkdown(result));
  } catch (error) {
    if (error instanceof PresentError) {
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
  const error = { error: msg("route_present_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
