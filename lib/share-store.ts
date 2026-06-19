import {
  ENCRYPTED_HTML_TTL_SECONDS,
  parseEncryptedHtmlPayload,
  type EncryptedHtmlPayload,
} from "@/lib/encrypted-html";

export type ShareRecord = {
  payload: EncryptedHtmlPayload | null;
  loadError: string | null;
};

export type ShareRecordStore = {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
};

export async function getShareRecord(store: ShareRecordStore, id: string): Promise<ShareRecord> {
  const raw = await store.get(id, "text");
  if (!raw) {
    return { payload: null, loadError: null };
  }

  let payload: EncryptedHtmlPayload;
  try {
    payload = parseEncryptedHtmlPayload(JSON.parse(raw));
  } catch {
    return { payload: null, loadError: "This share payload is damaged." };
  }

  try {
    await store.put(id, raw, { expirationTtl: ENCRYPTED_HTML_TTL_SECONDS });
  } catch {
    // Renewal is best-effort; viewing should still work if the write fails.
  }

  return { payload, loadError: null };
}
