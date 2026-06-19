import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_HTML_ALGORITHM,
  ENCRYPTED_HTML_TTL_SECONDS,
  ENCRYPTED_HTML_VERSION,
} from "../lib/encrypted-html";
import { getShareRecord, type ShareRecordStore } from "../lib/share-store";

function base64Url(bytes: number, fill: number): string {
  return Buffer.from(new Uint8Array(bytes).fill(fill)).toString("base64url");
}

const validPayload = {
  version: ENCRYPTED_HTML_VERSION,
  alg: ENCRYPTED_HTML_ALGORITHM,
  title: "Renew Me",
  filename: "renew.html",
  iv: base64Url(16, 1),
  ciphertext: base64Url(16, 2),
  mac: base64Url(32, 3),
};
const validRaw = JSON.stringify(validPayload);

class MemoryShareStore implements ShareRecordStore {
  values = new Map<string, string>();
  puts: Array<{
    key: string;
    options?: { expirationTtl?: number };
    value: string;
  }> = [];
  failPut = false;

  async get(key: string, type: "text"): Promise<string | null> {
    expect(type).toBe("text");
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (this.failPut) throw new Error("put failed");
    this.puts.push({ key, value, options });
    this.values.set(key, value);
  }
}

describe("share store", () => {
  it("renews a valid share for another TTL window when it is accessed", async () => {
    const store = new MemoryShareStore();
    store.values.set("share-id", validRaw);

    await expect(getShareRecord(store, "share-id")).resolves.toMatchObject({
      loadError: null,
      payload: {
        title: "Renew Me",
        filename: "renew.html",
      },
    });
    expect(store.puts).toEqual([
      {
        key: "share-id",
        value: validRaw,
        options: { expirationTtl: ENCRYPTED_HTML_TTL_SECONDS },
      },
    ]);
  });

  it("does not renew a missing share", async () => {
    const store = new MemoryShareStore();

    await expect(getShareRecord(store, "missing")).resolves.toEqual({
      payload: null,
      loadError: null,
    });
    expect(store.puts).toEqual([]);
  });

  it("does not renew a damaged share payload", async () => {
    const store = new MemoryShareStore();
    store.values.set("damaged", "{");

    await expect(getShareRecord(store, "damaged")).resolves.toEqual({
      payload: null,
      loadError: "This share payload is damaged.",
    });
    expect(store.puts).toEqual([]);
  });

  it("still returns the share when renewal fails", async () => {
    const store = new MemoryShareStore();
    store.values.set("share-id", validRaw);
    store.failPut = true;

    await expect(getShareRecord(store, "share-id")).resolves.toMatchObject({
      loadError: null,
      payload: { title: "Renew Me" },
    });
    expect(store.puts).toEqual([]);
  });
});
