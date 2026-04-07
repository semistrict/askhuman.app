import { DebugIndexDO } from "@/worker/debug-index";
import { SessionDO } from "@/worker/session";
import {
  debugEvalMarkdown,
  errorMarkdown,
  negotiatedResponse,
} from "@/lib/rest-response";

const DEBUG_EVAL_TIMEOUT_MS = 30_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tabId: string }> }
) {
  const { tabId } = await params;
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

  const tab = await DebugIndexDO.getInstance().getTab(tabId);
  if (!tab || !tab.connected) {
    const payload = { error: `Connected tab ${tabId} was not found.` };
    return negotiatedResponse(
      request,
      payload,
      errorMarkdown(payload.error),
      { status: 404 }
    );
  }

  try {
    const result = await SessionDO.getInstance(tab.sessionId).debugEvalTab(
      tabId,
      code,
      DEBUG_EVAL_TIMEOUT_MS
    );
    const payload = {
      tabId,
      sessionId: tab.sessionId,
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
  { params }: { params: Promise<{ tabId: string }> }
) {
  const { tabId } = await params;
  const payload = {
    error: `POST raw JavaScript to /debug/tabs/${tabId}/eval`,
  };
  return negotiatedResponse(
    request,
    payload,
    errorMarkdown(payload.error),
    { status: 405 }
  );
}
