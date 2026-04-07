import {
  requestDiffReview,
  RequestHunksValidationError,
} from "@/lib/diff-review";
import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import {
  errorMarkdown,
  negotiatedResponse,
  requestMarkdown,
} from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const formData = await request.formData();
    const result = await withTrackedAgentLongPoll(request, id, "diff_request", () =>
      requestDiffReview(id, formData, baseUrl)
    );
    return negotiatedResponse(request, result, requestMarkdown(result));
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const payload = {
    error: msg("route_diff_request_get", { ID: id }),
  };
  return negotiatedResponse(
    request,
    payload,
    errorMarkdown(payload.error),
    { status: 405 }
  );
}
