import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/plan-review";
import { negotiatedResponse, pollMarkdown } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await pollComments(
    id,
    REST_POLL_TIMEOUT_MS,
    baseUrl,
    "diff"
  );
  return negotiatedResponse(request, result, pollMarkdown(result));
}
