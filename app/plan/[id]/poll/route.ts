import {
  withTrackedAgentLongPoll,
} from "@/lib/hitl";
import { negotiatedResponse, pollMarkdown, type ContentContext } from "@/lib/rest-response";
import { SessionDO } from "@/worker/session";
import { pollDocReview } from "@/lib/plan-review";

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
    const session = SessionDO.getInstance(id);
    const data = await session.getContent();
    if (data) {
      context = new Map();
      context.set("__plan__", data.content.split("\n"));
    }
  }

  return negotiatedResponse(request, result, pollMarkdown({ ...result, context }));
}
