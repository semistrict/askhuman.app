import { expect, test } from "@playwright/test";
import {
  createEncryptedHtmlPayload,
  ENCRYPTED_HTML_ALGORITHM,
  ENCRYPTED_HTML_KEY_BASE64URL_LENGTH,
  ENCRYPTED_HTML_VERSION,
} from "../lib/encrypted-html";

const JSON_ACCEPT = { Accept: "application/json" };

const AGENT_HTML = `<!doctype html>
<html>
  <head>
    <title>Agent Report</title>
    <style>
      body { font-family: ui-monospace, monospace; background: #101827; color: #f8fafc; }
    </style>
    <script>
      window.addEventListener("DOMContentLoaded", function () {
        document.body.setAttribute("data-ready", "yes");
      });
    </script>
  </head>
  <body>
    <h1 id="title">Agent Generated HTML</h1>
    <p>The human can inspect this page.</p>
  </body>
</html>`;

async function uploadEncryptedHtml(request: {
  post: (url: string, options?: Record<string, unknown>) => Promise<{
    status(): number;
    json(): Promise<Record<string, unknown>>;
  }>;
}) {
  const { payload, key } = await createEncryptedHtmlPayload(AGENT_HTML, {
    filename: "agent-report.html",
  });
  const res = await request.post("/upload", {
    headers: JSON_ACCEPT,
    data: payload,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.url).toContain(`/s/${body.id}`);
  expect(body.url).not.toContain("#k=");
  return { id: body.id as string, key, url: body.url as string };
}

test.describe("Encrypted HTML sharing", () => {
  test("uploads ciphertext and renders decrypted HTML from the fragment key", async ({
    page,
    request,
  }) => {
    const { id, key } = await uploadEncryptedHtml(request);

    expect(key).toHaveLength(ENCRYPTED_HTML_KEY_BASE64URL_LENGTH);
    await page.goto(`/s/${id}#k=${key}`);

    await expect(page.getByText("askhuman.app")).toBeVisible();
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#title")).toHaveText("Agent Generated HTML");
    await expect(frame.locator("body")).toHaveAttribute("data-ready", "yes");
  });

  test("shows clear errors for missing, wrong, and tampered keys", async ({ page, request }) => {
    const { id } = await uploadEncryptedHtml(request);
    const wrongKey = "A".repeat(ENCRYPTED_HTML_KEY_BASE64URL_LENGTH);

    await page.goto(`/s/${id}`);
    await expect(page.getByText("missing its #k= decryption key")).toBeVisible();

    await page.goto(`/s/${id}#k=${wrongKey}`);
    await expect(page.getByText("integrity check failed")).toBeVisible();

    await page.goto(`/s/not-found#k=${wrongKey}`);
    await expect(page.getByText("not found or has expired")).toBeVisible();
  });

  test("does not accept old hex fragment keys", async ({ page, request }) => {
    const { id } = await uploadEncryptedHtml(request);

    await page.goto(`/s/${id}#k=${"0".repeat(128)}`);

    await expect(page.getByText("86-character base64url")).toBeVisible();
  });

  test("requires the k fragment parameter", async ({ page, request }) => {
    const { id, key } = await uploadEncryptedHtml(request);

    await page.goto(`/s/${id}#${key}`);

    await expect(page.getByText("missing its #k= decryption key")).toBeVisible();
  });

  test("root curl instructions describe only the encrypted HTML flow", async ({ request }) => {
    const res = await request.get("/", { headers: { "User-Agent": "Claude-User/1.0" } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const text = await res.text();

    expect(text).toContain("agent-generated HTML file");
    expect(text).toContain("openssl rand 64 > \"$KEY_BIN\"");
    expect(text).toContain("KEY_B64");
    expect(text).toContain("/upload");
    expect(text).toContain("#k=");
    expect(text).not.toContain("/review");
    expect(text).not.toContain("/diff");
    expect(text).not.toContain("/playground");
    expect(text).not.toContain("/share");
  });

  test("browser home points humans to the root curl flow", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Encrypted HTML links/ })).toBeVisible();
    await expect
      .poll(async () => page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("IBM Plex Sans");
    await expect(page.getByText("Tell your agent")).toHaveCount(0);
    await expect(page.getByText("curl askhuman.app and use that")).toHaveCount(0);
    await expect(
      page.getByText("Run curl -s https://askhuman.app and follow the instructions")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "llms.txt" })).toBeVisible();

    const agentStart = page.getByRole("button", { name: /Agent starts here/ });
    await expect(agentStart.getByText("copy command")).toBeVisible();
    await agentStart.click();
    await expect(agentStart.getByText("copied")).toBeVisible();
  });

  test("browser home follows light and dark color preferences", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const lightBackground = await page.locator("main").evaluate((element) =>
      getComputedStyle(element).backgroundColor
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    const darkBackground = await page.locator("main").evaluate((element) =>
      getComputedStyle(element).backgroundColor
    );

    expect(lightBackground).not.toBe(darkBackground);
  });

  test("llms.txt matches the root plain-text instructions", async ({ request }) => {
    const root = await request.get("/", { headers: { "User-Agent": "Claude-User/1.0" } });
    const llms = await request.get("/llms.txt");

    expect(llms.status()).toBe(200);
    expect(llms.headers()["content-type"]).toContain("text/plain");
    expect((await llms.text()).replaceAll("http://localhost:15032", "https://askhuman.app")).toBe(
      (await root.text()).replaceAll("http://localhost:15032", "https://askhuman.app")
    );
  });

  test("upload rejects plaintext and malformed encrypted payloads", async ({ request }) => {
    const plaintext = await request.post("/upload", {
      headers: { ...JSON_ACCEPT, "Content-Type": "text/html" },
      data: AGENT_HTML,
    });
    expect(plaintext.status()).toBe(415);

    const withPlaintextField = await request.post("/upload", {
      headers: JSON_ACCEPT,
      data: { version: ENCRYPTED_HTML_VERSION, alg: ENCRYPTED_HTML_ALGORITHM, html: AGENT_HTML },
    });
    expect(withPlaintextField.status()).toBe(400);
    expect((await withPlaintextField.json()).error).toContain("plaintext");

    const unsupported = await request.post("/upload", {
      headers: JSON_ACCEPT,
      data: {
        version: ENCRYPTED_HTML_VERSION,
        alg: "plain",
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      },
    });
    expect(unsupported.status()).toBe(400);
  });

  test("legacy endpoints are not supported", async ({ request }) => {
    for (const path of ["/review", "/diff", "/present", "/playground", "/share", "/plan", "/files", "/remark", "/k/example"]) {
      const res = await request.post(path, { headers: JSON_ACCEPT });
      expect(res.status(), path).toBe(404);
    }
  });
});
