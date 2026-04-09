import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { fileReviewPollContext, pollFileReview } from "@/lib/file-review";
import { negotiatedResponse, pollMarkdown, type ContentContext } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "file_poll", () =>
    pollFileReview(id, baseUrl)
  );

  let context: ContentContext | undefined;
  if (result.threads.length > 0) {
    context = await fileReviewPollContext(id);
  }

  return negotiatedResponse(request, result, pollMarkdown({ ...result, context }));
}
