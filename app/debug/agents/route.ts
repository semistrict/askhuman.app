import { errorMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function GET(request: Request) {
  const payload = {
    error: "Global debug agent listing is disabled. Use /s/{sessionId}/debug/agents instead.",
  };
  return negotiatedResponse(request, payload, errorMarkdown(payload.error), { status: 410 });
}
