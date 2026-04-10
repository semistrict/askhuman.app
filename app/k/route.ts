import { env } from "cloudflare:workers";
import { createCompactId } from "@/lib/compact-id";

const SHARE_KEY_TTL_SECONDS = 24 * 60 * 60;
const SHARE_KEY_ID_LENGTH = 11;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    keyId?: unknown;
    publicKeySpki?: unknown;
  };

  if (
    typeof body.keyId !== "string" ||
    !KEY_ID_RE.test(body.keyId) ||
    typeof body.publicKeySpki !== "string" ||
    !BASE64_URL_RE.test(body.publicKeySpki)
  ) {
    return Response.json(
      { error: "Expected keyId and publicKeySpki strings." },
      { status: 400 }
    );
  }

  const id = createCompactId(SHARE_KEY_ID_LENGTH);
  await env.SHARE_KEYS.put(
    id,
    JSON.stringify({
      recipientKeyId: body.keyId,
      publicKeySpki: body.publicKeySpki,
    }),
    { expirationTtl: SHARE_KEY_TTL_SECONDS }
  );

  const baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");
  return Response.json({
    id,
    url: `${baseUrl}/k/${id}`,
    expiresInSeconds: SHARE_KEY_TTL_SECONDS,
  });
}
