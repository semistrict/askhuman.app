import {
  pollComments,
  REST_POLL_TIMEOUT_MS,
  withTrackedAgentLongPoll,
} from "@/lib/hitl";
import { negotiatedResponse, pollMarkdown } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "plan_poll", () =>
    pollComments(id, REST_POLL_TIMEOUT_MS, baseUrl)
  );
  return negotiatedResponse(request, result, pollMarkdown(result));
}
