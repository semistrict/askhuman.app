import {
  completeDiffReview,
  RequestHunksValidationError,
} from "@/lib/diff-review";
import { msg } from "@/lib/agent-messages";
import {
  actionMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const diff = await request.text();
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const result = await completeDiffReview(id, diff, baseUrl);
    return negotiatedResponse(
      request,
      result,
      actionMarkdown("Diff Review Complete", result)
    );
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
  const payload = {
    error: msg("route_diff_complete_get"),
  };
  return negotiatedResponse(
    request,
    payload,
    errorMarkdown(payload.error),
    { status: 405 }
  );
}
