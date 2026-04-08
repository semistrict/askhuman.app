import {
  parsePlanUpdateRequest,
  updateDocReview,
  DocReviewError,
} from "@/lib/plan-review";
import { msg } from "@/lib/agent-messages";
import {
  errorMarkdown,
  negotiatedResponse,
  planUpdateMarkdown,
} from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const { markdown, response } = await parsePlanUpdateRequest(request);
    const result = await updateDocReview(id, markdown, response, baseUrl);
    return negotiatedResponse(request, result, planUpdateMarkdown(result));
  } catch (error) {
    if (error instanceof DocReviewError) {
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
  await params;
  const error = { error: msg("route_plan_update_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
