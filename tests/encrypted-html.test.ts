import { describe, expect, it } from "vitest";
import {
  createEncryptedHtmlPayload,
  decryptEncryptedHtmlPayload,
  ENCRYPTED_HTML_ALGORITHM,
  ENCRYPTED_HTML_KEY_BASE64URL_LENGTH,
  ENCRYPTED_HTML_VERSION,
  parseEncryptedHtmlPayload,
  parseUrlKey,
} from "../lib/encrypted-html";

const HTML = `<!doctype html>
<html>
  <body>
    <h1>Agent generated page</h1>
  </body>
</html>`;

function flipLastBase64UrlChar(value: string): string {
  const replacement = value.endsWith("A") ? "B" : "A";
  return `${value.slice(0, -1)}${replacement}`;
}

describe("encrypted HTML payloads", () => {
  it("encrypts and decrypts a single HTML document", async () => {
    const { payload, key } = await createEncryptedHtmlPayload(HTML, {
      filename: "page.html",
      title: "Agent Page",
    });

    expect(payload.version).toBe(ENCRYPTED_HTML_VERSION);
    expect(payload.alg).toBe(ENCRYPTED_HTML_ALGORITHM);
    expect(payload.title).toBe("Agent Page");
    expect(payload.filename).toBe("page.html");
    expect(key).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(parseUrlKey(key)).toHaveLength(64);
    await expect(decryptEncryptedHtmlPayload(payload, key)).resolves.toBe(HTML);
  });

  it("rejects wrong keys and tampered ciphertext", async () => {
    const { payload, key } = await createEncryptedHtmlPayload(HTML);
    const other = await createEncryptedHtmlPayload("<p>other</p>");
    const tampered = {
      ...payload,
      ciphertext: flipLastBase64UrlChar(payload.ciphertext),
    };

    await expect(decryptEncryptedHtmlPayload(payload, other.key)).rejects.toThrow(
      "integrity check failed"
    );
    await expect(decryptEncryptedHtmlPayload(tampered, key)).rejects.toThrow(
      "integrity check failed"
    );
  });

  it("validates payload and URL key shape", () => {
    expect(() => parseUrlKey("abc")).toThrow("86-character base64url");
    expect(() => parseUrlKey("0".repeat(128))).toThrow("86-character base64url");
    expect(ENCRYPTED_HTML_KEY_BASE64URL_LENGTH).toBe(86);
    expect(() =>
      parseEncryptedHtmlPayload({
        version: ENCRYPTED_HTML_VERSION,
        alg: ENCRYPTED_HTML_ALGORITHM,
        title: "x".repeat(141),
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      })
    ).toThrow("title");
    expect(() =>
      parseEncryptedHtmlPayload({
        version: ENCRYPTED_HTML_VERSION,
        alg: ENCRYPTED_HTML_ALGORITHM,
        html: HTML,
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      })
    ).toThrow("plaintext or keys");
    expect(() =>
      parseEncryptedHtmlPayload({
        version: ENCRYPTED_HTML_VERSION,
        alg: "plain",
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      })
    ).toThrow("Unsupported");
  });
});
