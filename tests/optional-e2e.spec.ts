import { expect, test } from "@playwright/test";
import {
  ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY,
  createEncryptedSharePayload,
  generateEncryptedShareKeyPair,
  type StoredEncryptedShareKeyPair,
} from "../lib/encrypted-share";

const JSON_ACCEPT = { Accept: "application/json" };
const LOCAL_ORIGIN = "http://localhost:15032";

async function startToolSession(
  request: { post: Function },
  tool: "review" | "diff" | "present" | "playground"
) {
  const res = await request.post(`/${tool}`, { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

async function enableEncryptionAndReadRecipient(
  page: { context: Function; goto: Function; getByRole: Function; evaluate: Function },
  sessionId: string
) {
  const recipient = await generateEncryptedShareKeyPair();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: LOCAL_ORIGIN,
  });
  await page.addInitScript(
    ({ storageKey, keyPair }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(keyPair));
    },
    {
      storageKey: ENCRYPTED_SHARE_KEYPAIR_STORAGE_KEY,
      keyPair: recipient,
    }
  );
  await page.goto(`/s/${sessionId}`);
  await expect(page.getByRole("button", { name: "Copy End-to-End Instructions" })).toBeVisible();
  return recipient as StoredEncryptedShareKeyPair;
}

function submitEncryptedToolPayload(
  tool: "review" | "diff" | "present" | "playground",
  sessionId: string,
  payload: unknown
) {
  return fetch(`http://localhost:15032/${tool}/${sessionId}`, {
    method: "POST",
    headers: {
      ...JSON_ACCEPT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function tamperBase64Url(value: string): string {
  const last = value.slice(-1);
  const replacement = last === "A" ? "B" : "A";
  return `${value.slice(0, -1)}${replacement}`;
}

test.describe("Optional End-to-End Encryption", () => {
  test("preserves doc-review behavior for encrypted review content", async ({ page, request }) => {
    const { sessionId } = await startToolSession(request, "review");
    const recipient = await enableEncryptionAndReadRecipient(page, sessionId);
    const envelope = await createEncryptedSharePayload(
      JSON.stringify({
        type: "review",
        files: [{ path: "secret.md", content: "# Review Secret\n\nOnly the browser should see this." }],
      }),
      recipient
    );

    const actionPromise = submitEncryptedToolPayload("review", sessionId, envelope);
    await expect(page.getByText("Review Secret")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request Revision" })).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Encrypted doc feedback" },
    });
    await page.getByRole("button", { name: "Request Revision" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Encrypted doc feedback");
  });

  test("decrypts encrypted diff content in-browser", async ({ page, request }) => {
    const { sessionId } = await startToolSession(request, "diff");
    const recipient = await enableEncryptionAndReadRecipient(page, sessionId);
    const envelope = await createEncryptedSharePayload(
      JSON.stringify({
        type: "diff",
        description: "## Secret diff\n\nOnly the browser should parse this diff.",
        diff: "diff --git a/app.txt b/app.txt\nindex 1111111..2222222 100644\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-old line\n+new line",
      }),
      recipient
    );

    const actionPromise = submitEncryptedToolPayload("diff", sessionId, envelope);
    await expect(page.getByRole("heading", { name: "Secret diff" })).toBeVisible();
    await expect(page.getByText("new line")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });

  test("decrypts encrypted presentation content in-browser", async ({ page, request }) => {
    const { sessionId } = await startToolSession(request, "present");
    const recipient = await enableEncryptionAndReadRecipient(page, sessionId);
    const envelope = await createEncryptedSharePayload(
      JSON.stringify({
        type: "present",
        markdown: "# Secret Slides\n\nHello\n\n---\n\n# Slide Two\n\nStill secret",
      }),
      recipient
    );

    const actionPromise = submitEncryptedToolPayload("present", sessionId, envelope);
    await expect(page.locator("header h1")).toHaveText("Secret Slides");
    await expect(page.getByRole("article").getByRole("heading", { name: "Secret Slides" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });

  test("offers a copied agent error when encrypted session decryption fails", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startToolSession(request, "present");
    const recipient = await enableEncryptionAndReadRecipient(page, sessionId);
    const envelope = await createEncryptedSharePayload(
      "# Broken Slides\n\nThis should fail integrity verification.",
      recipient
    );
    const tamperedEnvelope = {
      ...envelope,
      mac: tamperBase64Url(envelope.mac),
    };

    const actionPromise = submitEncryptedToolPayload("present", sessionId, tamperedEnvelope);
    await expect(page.getByText("Unable to decrypt session")).toBeVisible();
    await expect(page.getByText("Encrypted share MAC verification failed.")).toBeVisible();
    await page.getByRole("button", { name: "Copy Error for Agent" }).click();
    await expect(page.getByText("Error details copied for the agent.")).toBeVisible();
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())) as string)
      .toContain(`Error: Encrypted share MAC verification failed.`);
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())) as string)
      .toContain(`Session ID: ${sessionId}`);

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });

  test("decrypts encrypted playground content in-browser", async ({ page, request }) => {
    const { sessionId } = await startToolSession(request, "playground");
    const recipient = await enableEncryptionAndReadRecipient(page, sessionId);
    const envelope = await createEncryptedSharePayload(
      "<!doctype html><html><body><button>Secret Button</button><script>window.parent.postMessage({ type: 'askhuman:result', data: 'secret-result' }, '*');</script></body></html>",
      recipient
    );

    const actionPromise = submitEncryptedToolPayload("playground", sessionId, envelope);
    await expect(page.frameLocator("iframe").getByRole("button", { name: "Secret Button" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.result).toBe("secret-result");
  });

  test("offers fresh instructions when an encrypted tool payload targets a stale key", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startToolSession(request, "review");
    const currentRecipient = await enableEncryptionAndReadRecipient(page, sessionId);

    const staleKeyPair = await generateEncryptedShareKeyPair();
    const envelope = await createEncryptedSharePayload(
      JSON.stringify({
        type: "review",
        files: [{ path: "secret.md", content: "# Review Secret\n\nOnly the browser should see this." }],
      }),
      staleKeyPair
    );

    const actionPromise = submitEncryptedToolPayload("review", sessionId, envelope);
    await expect(page.getByText("Keys out of sync")).toBeVisible();
    await page.getByRole("button", { name: "Copy Fresh Instructions" }).click();
    await expect(page.getByText("Fresh agent instructions copied.")).toBeVisible();
    expect(currentRecipient.keyId).not.toBe(staleKeyPair.keyId);

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
  });

  test("continues without encryption when localStorage is unavailable", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startToolSession(request, "review");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: LOCAL_ORIGIN,
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("localStorage blocked for test");
        },
      });
    });

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("button", { name: "Continue Without Encryption" })).toBeVisible();
    await expect(page.getByText("End-to-end encryption is unavailable in this browser")).toBeVisible();
    await page.getByRole("button", { name: "Continue Without Encryption" }).click();
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())) as string)
      .toContain(`/review/${sessionId}`);
  });
});
