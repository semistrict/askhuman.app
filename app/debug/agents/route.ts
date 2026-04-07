import { DebugIndexDO } from "@/worker/debug-index";
import { debugAgentsMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function GET(request: Request) {
  const agents = await DebugIndexDO.getInstance().listConnectedAgents();
  const result = { agents };
  return negotiatedResponse(request, result, debugAgentsMarkdown(result));
}
