import { replyToComments, REST_POLL_TIMEOUT_MS } from "@/lib/plan-review";
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
  const body = (await request.json()) as {
    replies: { threadId: number; text: string }[];
  };
  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  const result = await replyToComments(
    id,
    body.replies,
    REST_POLL_TIMEOUT_MS,
    baseUrl,
    "diff"
  );
  return negotiatedResponse(request, result, replyMarkdown(result));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const error = { error: "POST replies to this endpoint" };
  return negotiatedResponse(
    request,
    error,
    errorMarkdown(error.error),
    { status: 405 }
  );
}
