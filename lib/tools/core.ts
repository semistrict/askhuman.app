import { createCompactId } from "@/lib/compact-id";
import { negotiatedResponse, pollMarkdown } from "@/lib/rest-response";
import { SessionDO } from "@/worker/session";
import type { Tool, ToolId, BootstrapResult, ActionResult } from "@/lib/tools/types";
import { withTrackedAgentLongPoll } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";

type GenericError = {
  status?: number;
  message?: string;
};

type ToolRegistry = Record<ToolId, Tool>;

let registry: ToolRegistry | null = null;

export function registerTools(next: ToolRegistry) {
  registry = next;
}

export function getTool(toolId: string): Tool {
  if (!registry) {
    throw new Error("Tool registry has not been initialized");
  }
  const tool = registry[toolId as ToolId];
  if (!tool) {
    const error = new Error(`Unknown tool: ${toolId}`) as GenericError;
    error.status = 404;
    throw error;
  }
  return tool;
}

export function getBaseUrl(request: Request): string {
  return new URL("/", request.url).toString().replace(/\/$/, "");
}

export async function bootstrapToolSession(toolId: string, request: Request): Promise<Response> {
  try {
    const tool = getTool(toolId);
    await assertBootstrapRequestIsEmpty(tool.id, request);
    const sessionId = createCompactId();
    const baseUrl = getBaseUrl(request);
    const session = SessionDO.getInstance(sessionId);
    await session.initializeBootstrapSession(sessionId, tool.id);
    const result = await tool.bootstrap({ sessionId, baseUrl });
    return negotiatedResponse(request, result, bootstrapMarkdown(result));
  } catch (error) {
    return toolErrorResponse(request, error);
  }
}

export async function performToolAction(
  toolId: string,
  sessionId: string,
  request: Request
): Promise<Response> {
  try {
    const tool = getTool(toolId);
    const baseUrl = getBaseUrl(request);
    const session = SessionDO.getInstance(sessionId);
    await ensureSessionTool(session, sessionId, tool.id);
    const input = await tool.parseActionRequest(request);
    await tool.applyAction({ sessionId, baseUrl, input });
    await session.activateSession();
    await session.broadcastViewUpdate();

    const result = await withTrackedAgentLongPoll(request, sessionId, `${tool.id}_poll`, async () => {
      if (!(await session.hasHumanConnected())) {
        const { connected } = await session.waitForHumanConnection(10_000);
        if (!connected) {
          const url = `${baseUrl}/s/${sessionId}`;
          return {
            status: "error" as const,
            threads: [],
            message: msg("plan_not_connected", { URL: url }),
            next: `curl -s ${baseUrl}/${tool.id}/${sessionId}/poll`,
            url,
          };
        }
      }
      return await tool.poll({ sessionId, baseUrl });
    });

    const context = tool.buildPollContext ? await tool.buildPollContext(sessionId) : undefined;
    const markdown = tool.renderPollMarkdown
      ? tool.renderPollMarkdown(result as never, context)
      : pollMarkdown({
          ...(result as Record<string, unknown>),
          ...(context ? { context } : {}),
        } as never);
    return negotiatedResponse(request, result, markdown);
  } catch (error) {
    return toolErrorResponse(request, error);
  }
}

export async function performToolPoll(
  toolId: string,
  sessionId: string,
  request: Request
): Promise<Response> {
  try {
    const tool = getTool(toolId);
    const baseUrl = getBaseUrl(request);
    const result = await withTrackedAgentLongPoll(request, sessionId, `${tool.id}_poll`, () =>
      tool.poll({ sessionId, baseUrl })
    );
    const context = tool.buildPollContext ? await tool.buildPollContext(sessionId) : undefined;
    const markdown = tool.renderPollMarkdown
      ? tool.renderPollMarkdown(result as never, context)
      : pollMarkdown({
          ...(result as Record<string, unknown>),
          ...(context ? { context } : {}),
        } as never);
    return negotiatedResponse(request, result, markdown);
  } catch (error) {
    return toolErrorResponse(request, error);
  }
}

async function ensureSessionTool(
  session: DurableObjectStub<SessionDO>,
  sessionId: string,
  toolId: ToolId
) {
  const stored = await session.getToolId();
  if (!stored) {
    await session.initializeBootstrapSession(sessionId, toolId);
    return;
  }
  if (stored !== toolId) {
    const error = new Error(`Session ${sessionId} belongs to ${stored}, not ${toolId}`) as GenericError;
    error.status = 409;
    throw error;
  }
}

function bootstrapMarkdown(result: BootstrapResult): string {
  return [
    `# ${titleForTool(result.tool)} Session`,
    "",
    `sessionId: ${result.sessionId}`,
    `url: ${result.url}`,
    "",
    "## Open For The User",
    "",
    result.message,
    "",
    "## Next",
    "",
    result.next,
  ].join("\n");
}

async function assertBootstrapRequestIsEmpty(toolId: ToolId, request: Request): Promise<void> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 0) {
    throw bootstrapPayloadError(toolId);
  }

  if (!request.headers.has("content-type")) {
    return;
  }

  const clone = request.clone();
  const body = await clone.arrayBuffer();
  if (body.byteLength > 0) {
    throw bootstrapPayloadError(toolId);
  }
}

function bootstrapPayloadError(toolId: ToolId): Error {
  return Object.assign(
    new Error(
      `POST /${toolId} only creates an empty ${titleForTool(toolId).toLowerCase()} session. ` +
        `Submit content with POST /${toolId}/{sessionId} instead.`
    ),
    { status: 400 }
  );
}

function titleForTool(tool: ToolId): string {
  if (tool === "review") return "Review";
  if (tool === "diff") return "Diff Review";
  if (tool === "present") return "Presentation";
  if (tool === "share") return "Encrypted Share";
  return "Playground";
}

function toolErrorResponse(request: Request, error: unknown): Response {
  const status =
    typeof error === "object" && error && "status" in error && typeof (error as GenericError).status === "number"
      ? (error as GenericError).status!
      : 400;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return negotiatedResponse(request, { error: message }, `# Error\n\n${message}`, { status });
}
