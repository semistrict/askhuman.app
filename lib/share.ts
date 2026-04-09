import {
  type EncryptedSharePayload,
  parseEncryptedSharePayload,
} from "@/lib/encrypted-share";
import { pollComments, REST_POLL_TIMEOUT_MS } from "@/lib/hitl";
import { msg } from "@/lib/agent-messages";
import { SessionDO } from "@/worker/session";

export class ShareError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ShareError";
    this.status = status;
  }
}

export async function createEncryptedShareSession(
  sessionId: string,
  payload: EncryptedSharePayload,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  await session.setContentType("share");
  await session.setContent(JSON.stringify(payload));

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
  };
}

export async function updateEncryptedShareSession(
  sessionId: string,
  payload: EncryptedSharePayload,
  baseUrl: string
) {
  const session = SessionDO.getInstance(sessionId);
  if (await session.isDone()) {
    await session.resetDone();
  }

  await session.setContentType("share");
  await session.setContent(JSON.stringify(payload));
  await session.broadcastViewUpdate();

  return {
    sessionId,
    url: `${baseUrl}/s/${sessionId}`,
  };
}

export async function pollEncryptedShare(sessionId: string, baseUrl: string) {
  const result = await pollComments(sessionId, REST_POLL_TIMEOUT_MS, baseUrl, "share");
  if (result.status === "done") {
    return { ...result, message: msg("share_done") };
  }
  if (result.status === "timeout") {
    return { ...result, message: msg("share_timeout") };
  }
  return result;
}

export async function parseEncryptedShareRequest(request: Request): Promise<EncryptedSharePayload> {
  const contentType = request.headers.get("content-type") || "";
  let raw = "";

  if (/\bmultipart\/form-data\b/i.test(contentType)) {
    const formData = await request.formData();
    const payloadValue = formData.get("payload") ?? formData.get("envelope");
    raw =
      typeof payloadValue === "string"
        ? payloadValue
        : payloadValue
          ? await payloadValue.text()
          : "";
  } else {
    raw = await request.text();
  }

  if (!raw.trim()) {
    throw new ShareError(msg("share_invalid_payload"));
  }

  try {
    return parseEncryptedSharePayload(JSON.parse(raw));
  } catch (error) {
    throw new ShareError(
      error instanceof Error ? error.message : msg("share_invalid_payload")
    );
  }
}
