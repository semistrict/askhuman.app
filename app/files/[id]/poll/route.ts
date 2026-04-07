import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { pollFileReview } from "@/lib/file-review";
import { negotiatedResponse, pollMarkdown, type ContentContext } from "@/lib/rest-response";
import { SessionDO } from "@/worker/session";

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
    const session = SessionDO.getInstance(id);
    const files = await session.getAllFiles();
    context = new Map();
    for (const file of files) {
      context.set(file.path, file.content.split("\n"));
    }
  }

  return negotiatedResponse(request, result, pollMarkdown({ ...result, context }));
}
