import { expect, test } from "@playwright/test";
import {
  createEncryptedSharePayload,
  generateEncryptedShareKeyPair,
  ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY,
  type SharedEncryptedSharePublicKey,
  type StoredEncryptedShareKeyPair,
} from "../lib/encrypted-share";

const JSON_ACCEPT = { Accept: "application/json" };
const LOCAL_ORIGIN = "http://localhost:15032";
const DOC = `# Top Secret Share

This document should only decrypt in the reviewer's browser.

- The server stores ciphertext.
- The browser keeps the private key in localStorage.
`;

async function startShareSession(request: { post: Function }) {
  const res = await request.post("/share", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

async function encryptedPayload(
  recipient:
    | Pick<StoredEncryptedShareKeyPair, "publicKeySpki" | "keyId">
    | SharedEncryptedSharePublicKey,
  markdown: string = DOC
) {
  return await createEncryptedSharePayload(markdown, recipient);
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

async function readStoredKeyPair(page: { evaluate: Function }) {
  return (await page.evaluate((storageKey: string) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  }, ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY)) as StoredEncryptedShareKeyPair | null;
}

function extractPublicKeyUrl(instructions: string): string {
  const match = instructions.match(/Fetch the recipient public key JSON from (\S+)/);
  if (!match) {
    throw new Error(`Recipient public key URL not found in instructions:\n${instructions}`);
  }
  return match[1];
}

test.describe("Encrypted Share", () => {
  test("starts an encrypted share session and returns the nested action endpoint", async ({
    request,
  }) => {
    const body = await startShareSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("localStorage permission");
    expect(body.next).toContain(`/share/${body.sessionId}`);
    expect(body.next).toContain("rsa-oaep-256+aes-256-cbc+hmac-sha256");
  });

  test("generates a local keypair, decrypts in-browser, and releases the waiting agent on Done", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startShareSession(request);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_ORIGIN,
    });

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Enable end-to-end encryption?")).toBeVisible();
    await page.getByRole("button", { name: "Enable & Copy Instructions" }).click();
    await expect(page.getByRole("button", { name: "Copy Agent Instructions" })).toBeVisible();

    const instructions = (await page.evaluate(() => navigator.clipboard.readText())) as string;
    const publicKeyUrl = extractPublicKeyUrl(instructions);
    expect(new URL(publicKeyUrl).pathname).toMatch(/^\/k\/[A-Za-z0-9_-]{11}$/);
    const keyResponse = await request.get(publicKeyUrl, { headers: JSON_ACCEPT });
    expect(keyResponse.status()).toBe(200);
    const recipient = (await keyResponse.json()) as SharedEncryptedSharePublicKey;

    const keyPair = await readStoredKeyPair(page);
    expect(keyPair?.keyId).toBeTruthy();
    expect(keyPair?.publicKeySpki).toBeTruthy();
    expect(recipient.recipientKeyId).toBe(keyPair?.keyId);

    const payload = await encryptedPayload(recipient);

    const actionPromise = submitShareSession(sessionId, payload);
    await expect(page.getByText("Top Secret Share")).toBeVisible();
    await expect(page.getByText("The browser keeps the private key in localStorage.")).toBeVisible();

    await page.getByRole("button", { name: "Done Reading" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.message).toContain("finished reviewing the encrypted document");
  });

  test("shows a clear error when the payload targets a different local key", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startShareSession(request);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_ORIGIN,
    });
    await page.goto(`/s/${sessionId}`);
    await page.getByRole("button", { name: "Enable & Copy Instructions" }).click();
    await expect(page.getByRole("button", { name: "Copy Agent Instructions" })).toBeVisible();

    const wrongRecipient = await generateEncryptedShareKeyPair();
    const payload = await encryptedPayload(wrongRecipient);

    const actionPromise = submitShareSession(sessionId, payload);
    await expect(page.getByText("different local key")).toBeVisible();
    await expect(page.getByText("Keys out of sync")).toBeVisible();
    await page.getByRole("button", { name: "Copy Fresh Instructions" }).click();
    const instructions = (await page.evaluate(() => navigator.clipboard.readText())) as string;
    const publicKeyUrl = extractPublicKeyUrl(instructions);
    const keyResponse = await request.get(publicKeyUrl, { headers: JSON_ACCEPT });
    expect(keyResponse.status()).toBe(200);
    const recipient = (await keyResponse.json()) as SharedEncryptedSharePublicKey;
    const keyPair = await readStoredKeyPair(page);
    expect(recipient.recipientKeyId).toBe(keyPair?.keyId);
    await expect(page.getByText("Top Secret Share")).not.toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });
});
