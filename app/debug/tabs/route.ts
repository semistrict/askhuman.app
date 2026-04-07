import { DebugIndexDO } from "@/worker/debug-index";
import { debugTabsMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function GET(request: Request) {
  const tabs = await DebugIndexDO.getInstance().listConnectedTabs();
  const result = { tabs };
  return negotiatedResponse(request, result, debugTabsMarkdown(result));
}
