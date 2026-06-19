import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { EncryptedHtmlPayload } from "@/lib/encrypted-html";
import { EncryptedHtmlViewer } from "./-encrypted-html-viewer";

const SHARE_PREVIEW_DESCRIPTION =
  "End-to-end encrypted HTML share. Open the complete link with its #k= fragment to decrypt locally.";

function getShareLabel(id: string, payload: EncryptedHtmlPayload | null): string {
  return payload?.title || payload?.filename || `share ${id}`;
}

const getShareData = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const [{ appEnv }, { getShareRecord }] = await Promise.all([
      import("@/lib/cloudflare-env"),
      import("@/lib/share-store"),
    ]);
    const record = await getShareRecord(appEnv.SHARE_KEYS, id);
    return { shareId: id, ...record };
  });

export const Route = createFileRoute("/s/$id")({
  loader: async ({ params }) => {
    return getShareData({ data: params.id });
  },
  head: ({ loaderData }) => {
    const data = loaderData ?? {
      shareId: "unknown",
      payload: null,
      loadError: "This encrypted HTML share was not found or has expired.",
    };
    const label = data.payload
      ? getShareLabel(data.shareId, data.payload)
      : "Encrypted HTML share";
    const title = `${label} | askhuman.app`;
    const description = data.payload
      ? SHARE_PREVIEW_DESCRIPTION
      : "This encrypted HTML share was not found or has expired.";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "noindex,nofollow" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: "askhuman.app" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  component: SharePage,
});

function SharePage() {
  const { shareId, payload, loadError } = Route.useLoaderData();

  return <EncryptedHtmlViewer shareId={shareId} payload={payload} loadError={loadError} />;
}
