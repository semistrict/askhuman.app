import {
  parseRepliesRequest,
  replyToComments,
  REST_POLL_TIMEOUT_MS,
  withTrackedAgentLongPoll,
} from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import {
  errorMarkdown,
  negotiatedResponse,
  replyMarkdown,
} from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const replies = await parseRepliesRequest(request);
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await withTrackedAgentLongPoll(request, id, "plan_reply", () =>
    replyToComments(
      id,
      replies,
      REST_POLL_TIMEOUT_MS,
      baseUrl
    )
  );
  return negotiatedResponse(request, result, replyMarkdown(result));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const error = { error: msg("route_plan_reply_get") };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
