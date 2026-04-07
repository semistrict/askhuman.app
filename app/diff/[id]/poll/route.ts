import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { pollDiffReview } from "@/lib/diff-review";
import { negotiatedResponse, pollMarkdown, type ContentContext } from "@/lib/rest-response";
import { SessionDO } from "@/worker/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "diff_poll", () =>
    pollDiffReview(id, baseUrl)
  );

  let context: ContentContext | undefined;
  if (result.threads.length > 0) {
    const session = SessionDO.getInstance(id);
    const hunks = await session.getAllHunks();
    context = new Map();
    for (const hunk of hunks) {
      context.set(hunk.id, hunk.content.split("\n"));
    }
  }

  return negotiatedResponse(request, result, pollMarkdown({ ...result, context }));
}
