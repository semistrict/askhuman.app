import { env } from "cloudflare:workers";
import { parseEncryptedHtmlPayload, type EncryptedHtmlPayload } from "@/lib/encrypted-html";
import { EncryptedHtmlViewer } from "./encrypted-html-viewer";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const raw = await env.SHARE_KEYS.get(id, "text");
  let payload: EncryptedHtmlPayload | null = null;
  let loadError: string | null = null;

  if (raw) {
    try {
      payload = parseEncryptedHtmlPayload(JSON.parse(raw));
    } catch {
      loadError = "This share payload is damaged.";
    }
  }

  return <EncryptedHtmlViewer shareId={id} payload={payload} loadError={loadError} />;
}
