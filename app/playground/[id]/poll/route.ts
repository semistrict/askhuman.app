import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { pollPlayground } from "@/lib/playground";
import { negotiatedResponse, playgroundPollMarkdown } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "playground_poll", () =>
    pollPlayground(id, baseUrl)
  );
  return negotiatedResponse(request, result, playgroundPollMarkdown(result));
}
