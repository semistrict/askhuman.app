import {
  withTrackedAgentLongPoll,
} from "@/lib/hitl";
import { negotiatedResponse, pollMarkdown, type ContentContext } from "@/lib/rest-response";
import { pollDocReview } from "@/lib/plan-review";
import { fileReviewPollContext } from "@/lib/file-review";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "plan_poll", () =>
    pollDocReview(id, baseUrl)
  );

  let context: ContentContext | undefined;
  if (result.threads.length > 0) {
    context = await fileReviewPollContext(id);
  }

  return negotiatedResponse(request, result, pollMarkdown({ ...result, context }));
}
