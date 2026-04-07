import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { pollFileReview } from "@/lib/file-review";
import { negotiatedResponse, pollMarkdown } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "file_poll", () =>
    pollFileReview(id, baseUrl)
  );
  return negotiatedResponse(request, result, pollMarkdown(result));
}
