import { describe, expect, it } from "vitest";
import type { EncryptedHtmlPayload } from "../lib/encrypted-html";
import {
  CLIENT_UPLOAD_BYTES_LIMIT,
  CLIENT_UPLOAD_COUNT_LIMIT,
  CLIENT_UPLOAD_WINDOW_SECONDS,
  createUploadActorKey,
  estimateUploadBytes,
  getDetectedClientIp,
  reserveClientUploadQuota,
} from "../lib/upload-limits";

class MemoryKv {
  values = new Map<string, string>();

  async get<T = unknown>(key: string, type: "json"): Promise<T | null> {
    expect(type).toBe("json");
    const value = this.values.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const payload: EncryptedHtmlPayload = {
  version: 1,
  alg: "aes-256-cbc+hmac-sha256",
  iv: "A".repeat(22),
  ciphertext: "B".repeat(64),
  mac: "C".repeat(43),
};

describe("upload limits", () => {
  it("uses Cloudflare detected IP before local development fallbacks", () => {
    const cfRequest = new Request("https://askhuman.app/upload", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1",
      },
    });
    const forwardedRequest = new Request("https://askhuman.app/upload", {
      headers: {
        "x-forwarded-for": "198.51.100.2, 198.51.100.3",
      },
    });

    expect(getDetectedClientIp(cfRequest)).toBe("203.0.113.10");
    expect(getDetectedClientIp(forwardedRequest)).toBe("198.51.100.2");
    expect(getDetectedClientIp(new Request("https://askhuman.app/upload"))).toBe("dev-local");
  });

  it("hashes the upload actor key deterministically", async () => {
    const request = new Request("https://askhuman.app/upload", {
      headers: { "cf-connecting-ip": "203.0.113.20" },
    });

    const first = await createUploadActorKey(request);
    const second = await createUploadActorKey(request);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("203.0.113.20");
  });

  it("estimates upload size from content-length when available", () => {
    expect(estimateUploadBytes(payload, 1234)).toBe(1234);
    expect(estimateUploadBytes(payload, null)).toBeGreaterThan(100);
  });

  it("rejects clients that exceed the daily upload count", async () => {
    const kv = new MemoryKv();
    const now = Date.UTC(2026, 5, 18, 12);

    for (let index = 0; index < CLIENT_UPLOAD_COUNT_LIMIT; index += 1) {
      await expect(reserveClientUploadQuota(kv, "actor", 1, now)).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(reserveClientUploadQuota(kv, "actor", 1, now)).resolves.toMatchObject({
      allowed: false,
      message: expect.stringContaining("count"),
    });
  });

  it("rejects clients that exceed the daily upload byte budget", async () => {
    const kv = new MemoryKv();
    const now = Date.UTC(2026, 5, 18, 12);

    await expect(
      reserveClientUploadQuota(kv, "actor", CLIENT_UPLOAD_BYTES_LIMIT - 10, now)
    ).resolves.toMatchObject({ allowed: true });
    await expect(reserveClientUploadQuota(kv, "actor", 11, now)).resolves.toMatchObject({
      allowed: false,
      message: expect.stringContaining("size"),
    });
  });

  it("resets quota in the next daily window", async () => {
    const kv = new MemoryKv();
    const now = Date.UTC(2026, 5, 18, 12);
    const nextWindow = now + CLIENT_UPLOAD_WINDOW_SECONDS * 1000;

    await expect(
      reserveClientUploadQuota(kv, "actor", CLIENT_UPLOAD_BYTES_LIMIT, now)
    ).resolves.toMatchObject({ allowed: true });
    await expect(reserveClientUploadQuota(kv, "actor", 1, now)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(reserveClientUploadQuota(kv, "actor", 1, nextWindow)).resolves.toMatchObject({
      allowed: true,
      count: 1,
      bytes: 1,
    });
  });
});
