import {
  dismissRequest,
  RequestHunksValidationError,
} from "@/lib/diff-review";
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
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

  try {
    const result = await dismissRequest(id, baseUrl);
    return negotiatedResponse(
      request,
      result,
      actionMarkdown("Request Dismissed", result)
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
