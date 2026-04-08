import { SessionDO } from "@/worker/session";
import {
  debugEvalMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

const DEBUG_EVAL_TIMEOUT_MS = 30_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const { id, tabId } = await params;
  const code = await request.text();
  if (!code.trim()) {
    const payload = { error: "POST raw JavaScript in the request body." };
    return negotiatedResponse(
      request,
      payload,
      errorMarkdown(payload.error),
      { status: 400 }
    );
  }

  const tabs = await SessionDO.getInstance(id).listConnectedTabs();
  const tab = tabs.find((entry) => entry.tabId === tabId && entry.connected);
  if (!tab) {
    const payload = { error: `Connected tab ${tabId} was not found in session ${id}.` };
    return negotiatedResponse(
      request,
      payload,
      errorMarkdown(payload.error),
      { status: 404 }
    );
  }

  try {
    const result = await SessionDO.getInstance(id).debugEvalTab(
      tabId,
      code,
      DEBUG_EVAL_TIMEOUT_MS
    );
    const payload = {
      tabId,
      sessionId: id,
      ...result,
    };
    return negotiatedResponse(request, payload, debugEvalMarkdown(payload));
  } catch (error) {
    const payload = {
      error: error instanceof Error ? error.message : String(error),
    };
    return negotiatedResponse(
      request,
      payload,
      errorMarkdown(payload.error),
      { status: 409 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const { id, tabId } = await params;
  const payload = {
    error: `POST raw JavaScript to /s/${id}/debug/tabs/${tabId}/eval`,
  };
  return negotiatedResponse(
    request,
    payload,
    errorMarkdown(payload.error),
    { status: 405 }
  );
}
