import type { EncryptedSharePayload } from "@/lib/encrypted-share";
import { parseEncryptedSharePayload } from "@/lib/encrypted-share";
import { SessionDO } from "@/worker/session";
import type { ToolId } from "@/lib/tools/types";

type ContentType = "files" | "diff" | "playground" | "present" | "share";

function contentTypeForTool(toolId: ToolId): ContentType {
  if (toolId === "review") return "files";
  if (toolId === "diff") return "diff";
  if (toolId === "playground") return "playground";
  if (toolId === "present") return "present";
  return "share";
}

export async function parseMaybeEncryptedEnvelopeRequest(
  request: Request
): Promise<EncryptedSharePayload | null> {
  const contentType = request.headers.get("content-type") || "";
  if (!/\bapplication\/json\b/i.test(contentType)) {
    return null;
  }

  const raw = await request.clone().text();
  if (!raw.trim()) {
    return null;
  }

  try {
    return parseEncryptedSharePayload(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to parse encrypted envelope request", error);
    return null;
  }
}

export async function createEncryptedToolSession(
  sessionId: string,
  toolId: ToolId,
  payload: EncryptedSharePayload,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  await session.clearStructuredContent();
  await session.setContentType(contentTypeForTool(toolId));
  await session.setEncryptionMode("e2e");
  if (toolId === "review") {
    await session.setReviewMode("files");
  }
  await session.setContent(JSON.stringify(payload));

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
  };
}

export async function updateEncryptedToolSession(
  sessionId: string,
  toolId: ToolId,
  payload: EncryptedSharePayload,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    await session.resetDone();
  }

  await session.clearStructuredContent();
  await session.setContentType(contentTypeForTool(toolId));
  await session.setEncryptionMode("e2e");
  if (toolId === "review") {
    await session.setReviewMode("files");
  }
  await session.markAllThreadsOutdated();
  await session.setContent(JSON.stringify(payload));
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
  };
}
