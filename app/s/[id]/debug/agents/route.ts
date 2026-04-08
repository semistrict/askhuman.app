import { SessionDO } from "@/worker/session";
import { debugAgentsMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const agents = await SessionDO.getInstance(id).listConnectedAgents();
  const result = { agents };
  return negotiatedResponse(request, result, debugAgentsMarkdown(result));
}
