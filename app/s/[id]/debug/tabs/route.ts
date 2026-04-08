import { SessionDO } from "@/worker/session";
import { debugTabsMarkdown, negotiatedResponse } from "@/lib/rest-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tabs = await SessionDO.getInstance(id).listConnectedTabs();
  const result = { tabs };
  return negotiatedResponse(request, result, debugTabsMarkdown(result));
}
