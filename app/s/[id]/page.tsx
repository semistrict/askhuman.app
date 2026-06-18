import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { cache } from "react";
import { parseEncryptedHtmlPayload, type EncryptedHtmlPayload } from "@/lib/encrypted-html";
import { EncryptedHtmlViewer } from "./encrypted-html-viewer";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{ id: string }>;
};

type ShareRecord = {
  payload: EncryptedHtmlPayload | null;
  loadError: string | null;
};

const SHARE_PREVIEW_DESCRIPTION =
  "End-to-end encrypted HTML share. Open the complete link with its #k= fragment to decrypt locally.";

const getShareRecord = cache(async (id: string): Promise<ShareRecord> => {
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

  return { payload, loadError };
});

function getShareLabel(id: string, payload: EncryptedHtmlPayload | null): string {
  return payload?.title || payload?.filename || `share ${id}`;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { id } = await params;
  const { payload } = await getShareRecord(id);
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
  const { payload, loadError } = await getShareRecord(id);

  return <EncryptedHtmlViewer shareId={id} payload={payload} loadError={loadError} />;
}
