import { createSession } from "@/lib/plan-review";
import {
  createPlayground,
  updatePlayground,
  parsePlaygroundFormData,
  PlaygroundError,
} from "@/lib/playground";
import { msg } from "@/lib/agent-messages";
import {
  playgroundSubmitMarkdown,
  playgroundUpdateMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(request: Request) {
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const formData = await request.formData();
    const { html, sessionId: existingSessionId } = parsePlaygroundFormData(formData);

    if (!html.trim()) {
      throw new PlaygroundError(msg("playground_no_html"));
    }

    if (existingSessionId) {
      const result = await updatePlayground(existingSessionId, html, baseUrl);
      return negotiatedResponse(request, result, playgroundUpdateMarkdown(result));
    }

    const id = createSession();
    const result = await createPlayground(id, html, baseUrl);
    return negotiatedResponse(request, result, playgroundSubmitMarkdown(result));
  } catch (error) {
    if (error instanceof PlaygroundError) {
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
  const error = { error: "POST HTML to create a playground session" };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
