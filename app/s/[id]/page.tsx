import type { Metadata } from "next";
import { cache } from "react";
import { appEnv } from "@/lib/cloudflare-env";
import type { EncryptedHtmlPayload } from "@/lib/encrypted-html";
import { getShareRecord } from "@/lib/share-store";
import { EncryptedHtmlViewer } from "./encrypted-html-viewer";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{ id: string }>;
};

const SHARE_PREVIEW_DESCRIPTION =
  "End-to-end encrypted HTML share. Open the complete link with its #k= fragment to decrypt locally.";

const getCachedShareRecord = cache((id: string) => getShareRecord(appEnv.SHARE_KEYS, id));

function getShareLabel(id: string, payload: EncryptedHtmlPayload | null): string {
  return payload?.title || payload?.filename || `share ${id}`;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { id } = await params;
  const { payload } = await getCachedShareRecord(id);
  const label = payload ? getShareLabel(id, payload) : "Encrypted HTML share";
  const title = `${label} | askhuman.app`;
  const description = payload
    ? SHARE_PREVIEW_DESCRIPTION
    : "This encrypted HTML share was not found or has expired.";

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title,
      description,
      siteName: "askhuman.app",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { id } = await params;
  const { payload, loadError } = await getCachedShareRecord(id);

  return <EncryptedHtmlViewer shareId={id} payload={payload} loadError={loadError} />;
}
