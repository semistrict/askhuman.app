import { errorMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tabId: string }> }
) {
  await params;
  const payload = {
    error: "Global debug eval is disabled. Use /s/{sessionId}/debug/tabs/{tabId}/eval instead.",
  };
  return negotiatedResponse(request, payload, errorMarkdown(payload.error), { status: 410 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tabId: string }> }
) {
  const { tabId } = await params;
  const payload = {
    error: `POST raw JavaScript to /s/{sessionId}/debug/tabs/${tabId}/eval`,
  };
  return negotiatedResponse(
    request,
    payload,
    errorMarkdown(payload.error),
    { status: 405 }
  );
}
