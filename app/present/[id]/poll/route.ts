import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { pollPresentation } from "@/lib/present";
import { negotiatedResponse, pollMarkdown } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "present_poll", () =>
    pollPresentation(id, baseUrl)
  );
  return negotiatedResponse(request, result, pollMarkdown(result));
}
