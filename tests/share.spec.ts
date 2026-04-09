import { expect, test } from "@playwright/test";
import { createEncryptedSharePayload } from "../lib/encrypted-share";

const JSON_ACCEPT = { Accept: "application/json" };
const DOC = `# Top Secret Share

This document should only decrypt in the reviewer's browser.

- The server stores ciphertext.
- The key lives in the URL fragment.
`;

const MASTER_KEY = Uint8Array.from(
  Array.from({ length: 64 }, (_, index) => (index * 17 + 9) % 256)
);
const IV = Uint8Array.from(
  Array.from({ length: 16 }, (_, index) => (index * 29 + 5) % 256)
);

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MASTER_KEY_HEX = hex(MASTER_KEY);

async function startShareSession(request: { post: Function }) {
  const res = await request.post("/share", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

async function encryptedPayload(markdown: string = DOC) {
  return await createEncryptedSharePayload(markdown, MASTER_KEY, IV);
}

function submitShareSession(sessionId: string, payload: unknown) {
  return fetch(`http://localhost:15032/share/${sessionId}`, {
    method: "POST",
    headers: {
      ...JSON_ACCEPT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test.describe("Encrypted Share", () => {
  test("starts an encrypted share session and returns the nested action endpoint", async ({
    request,
  }) => {
    const body = await startShareSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("server must only receive ciphertext");
    expect(body.next).toContain(`/share/${body.sessionId}`);
    expect(body.next).toContain("openssl enc -aes-256-cbc");
  });

  test("decrypts the document in-browser with the fragment key and releases the waiting agent on Done", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startShareSession(request);
    const payload = await encryptedPayload();

    await page.goto(`/s/${sessionId}#key=${MASTER_KEY_HEX}`);

    const actionPromise = submitShareSession(sessionId, payload);
    await expect(page.getByText("Top Secret Share")).toBeVisible();
    await expect(page.getByText("The server stores ciphertext.")).toBeVisible();

    await page.getByRole("button", { name: "Done Reading" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.message).toContain("finished reviewing the encrypted document");
  });

  test("keeps the plaintext hidden when the URL fragment key is missing", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startShareSession(request);
    const payload = await encryptedPayload();

    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitShareSession(sessionId, payload);
    await expect(page.getByText("Missing decryption key")).toBeVisible();
    await expect(page.getByText("Top Secret Share")).not.toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });
});
