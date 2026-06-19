import { expect, test } from "@playwright/test";
import {
  createEncryptedHtmlPayload,
  ENCRYPTED_HTML_ALGORITHM,
  ENCRYPTED_HTML_COMPRESSION,
  ENCRYPTED_HTML_KEY_BASE64URL_LENGTH,
  ENCRYPTED_HTML_VERSION,
  MAX_UPLOAD_FORM_BYTES,
} from "../lib/encrypted-html";

const JSON_ACCEPT = { Accept: "application/json" };
type EncryptedUploadForm = Record<string, string>;

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

function encryptedPayloadToMultipart(payload: {
  version: number;
  alg: string;
  compression?: string;
  title?: string;
  filename?: string;
  iv: string;
  ciphertext: string;
  mac: string;
}): EncryptedUploadForm {
  return {
    version: String(payload.version),
    alg: payload.alg,
    ...(payload.compression ? { compression: payload.compression } : {}),
    ...(payload.title ? { title: payload.title } : {}),
    ...(payload.filename ? { filename: payload.filename } : {}),
    iv: payload.iv,
    ciphertext: payload.ciphertext,
    mac: payload.mac,
  };
}

async function uploadEncryptedHtml(request: {
  post: (url: string, options?: Record<string, unknown>) => Promise<{
    status(): number;
    json(): Promise<Record<string, unknown>>;
  }>;
}) {
  const { payload, key } = await createEncryptedHtmlPayload(AGENT_HTML, {
    filename: "agent-report.html",
    title: "Human Preview",
  });
  const res = await request.post("/upload", {
    headers: JSON_ACCEPT,
    multipart: encryptedPayloadToMultipart(payload),
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

    await expect(page.getByRole("link", { name: "askhuman.app" })).toHaveAttribute("href", "/");
    await expect(page.getByText("end-to-end encrypted")).toBeVisible();
    await expect(page).toHaveTitle("Human Preview | askhuman.app");
    await expect(page.locator("header").getByText("Human Preview", { exact: true })).toBeVisible();
    await expect(page.locator("iframe")).toHaveAttribute("allow", "clipboard-write");
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts allow-forms");
    await expect(page.locator("iframe")).toHaveAttribute("csp", /https:\/\/cdn\.jsdelivr\.net/);
    await expect(page.locator("iframe")).toHaveAttribute("csp", /https:\/\/fonts\.googleapis\.com/);
    await expect(page.locator("iframe")).toHaveAttribute("csp", /https:\/\/fonts\.gstatic\.com/);
    await expect(page.locator("iframe")).toHaveAttribute("csp", /https:\/\/www\.gstatic\.com/);
    await expect(page.locator("iframe")).toHaveAttribute("csp", /https:\/\/chart\.googleapis\.com/);
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

  test("share pages expose safe link-preview metadata", async ({ request }) => {
    const { id, key } = await uploadEncryptedHtml(request);

    const res = await request.get(`/s/${id}`, {
      headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();

    expect(html).toContain("Human Preview | askhuman.app");
    expect(html).toContain("og:title");
    expect(html).toContain("twitter:card");
    expect(html).toContain("End-to-end encrypted HTML share");
    expect(html).not.toContain(key);
    expect(html).not.toContain("Agent Generated HTML");
  });

  test("public responses include launch security headers", async ({ request }) => {
    const browserRoot = await request.get("/", {
      headers: { "User-Agent": "Mozilla/5.0 launch-smoke" },
    });
    const curlRoot = await request.get("/", { headers: { "User-Agent": "curl/8.7.1" } });
    const uploadGet = await request.get("/upload");

    for (const res of [browserRoot, curlRoot, uploadGet]) {
      expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      expect(res.headers()["referrer-policy"]).toBe("no-referrer");
      expect(res.headers()["strict-transport-security"]).toBe("max-age=31536000");
      expect(res.headers()["permissions-policy"]).toContain("camera=()");
      expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
  });

  test("serves the favicon assets", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="icon"][href="/favicon-light.ico"]')).toHaveAttribute(
      "media",
      "(prefers-color-scheme: light)"
    );
    await expect(page.locator('link[rel="icon"][href="/favicon-light.ico"]')).toHaveAttribute(
      "type",
      "image/x-icon"
    );
    await expect(page.locator('link[rel="icon"][href="/favicon-dark.ico"]')).toHaveAttribute(
      "media",
      "(prefers-color-scheme: dark)"
    );
    await expect(page.locator('link[rel="icon"][href="/favicon-dark.ico"]')).toHaveAttribute(
      "type",
      "image/x-icon"
    );
    await expect(page.locator('link[rel="alternate icon"][href="/favicon.ico"]')).toHaveAttribute(
      "sizes",
      "32x32"
    );

    for (const path of ["/favicon.ico", "/favicon-light.ico", "/favicon-dark.ico"]) {
      const ico = await request.get(path);
      expect(ico.status(), path).toBe(200);
      expect(ico.headers()["content-type"]).toContain("image/x-icon");
      expect((await ico.body()).byteLength, path).toBeGreaterThan(1000);
    }

    for (const path of ["/favicon-light.svg", "/favicon-dark.svg"]) {
      const source = await request.get(path);
      expect(source.status(), path).toBe(200);
      expect(source.headers()["content-type"]).toContain("image/svg+xml");
      expect(await source.text()).toContain("askhuman icon");
    }
  });

  test("root curl instructions describe only the encrypted HTML flow", async ({ request }) => {
    const res = await request.get("/", { headers: { "User-Agent": "Claude-User/1.0" } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const text = await res.text();

    expect(text).toContain("agent-generated HTML file");
    expect(text).toContain("Compress the HTML file with gzip before encrypting it locally");
    expect(text).toContain("Required multipart form fields");
    expect(text).toContain("compression=gzip");
    expect(text).toContain("title=<browser/link-preview title>");
    expect(text).toContain("HTML expectations");
    expect(text).toContain("Single HTML file");
    expect(text).toContain("viewer allowlist");
    expect(text).toContain("Google Charts");
    expect(text).toContain("https://www.gstatic.com/charts/loader.js");
    expect(text).toContain("Google Fonts");
    expect(text).toContain("every control should update the visible preview immediately");
    expect(text).toContain("3-5 named presets");
    expect(text).toContain("All other network access is blocked");
    expect(text).not.toContain("Do not depend on CDNs");
    expect(text).toContain("Upload limits");
    expect(text).toContain("Uploads are abuse-limited per client");
    expect(text).not.toContain("upload attempts per minute");
    expect(text).not.toContain("successful uploads");
    expect(text).not.toContain("uploaded per day");
    expect(text).toContain("--form-string \"version=1\"");
    expect(text).toContain("openssl rand 64 > \"$KEY_BIN\"");
    expect(text).toContain("KEY_B64");
    expect(text).toContain("gzip -n -c");
    expect(text).toContain('HTTP_STATUS="$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}"');
    expect(text).toContain('case "$HTTP_STATUS" in');
    expect(text).toContain("Upload failed (%s): %s");
    expect(text).toContain("OpenSSL + curl recipe");
    expect(text).not.toContain("PowerShell + .NET recipe");
    expect(text).toContain("/upload");
    expect(text).toContain("#k=");
    expect(text).not.toContain("Content-Type: application/json");
    expect(text).not.toContain("--data-binary");
    expect(text).not.toContain("encrypted JSON");
    expect(text).not.toContain("/review");
    expect(text).not.toContain("/diff");
    expect(text).not.toContain("/playground");
    expect(text).not.toContain("/share");
    expect(text).not.toContain("postMessage");
  });

  test("root curl instructions use PowerShell and .NET for Windows callers", async ({
    request,
  }) => {
    const windowsPowerShell = await request.get("/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.2506",
      },
    });
    expect(windowsPowerShell.status()).toBe(200);
    expect(windowsPowerShell.headers()["content-type"]).toContain("text/plain");
    const text = await windowsPowerShell.text();

    expect(text).toContain("PowerShell + .NET recipe for Windows");
    expect(text).toContain("Add-Type -AssemblyName System.Net.Http");
    expect(text).toContain("[IO.Compression.GZipStream]");
    expect(text).toContain("[Security.Cryptography.Aes]::Create()");
    expect(text).toContain("[Security.Cryptography.HMACSHA256]");
    expect(text).toContain("[System.Net.Http.MultipartFormDataContent]");
    expect(text).toContain('Add-Field "compression" "gzip"');
    expect(text).toContain('"$BaseUrl/upload"');
    expect(text).not.toContain("OpenSSL + curl recipe");

    const windowsCurl = await request.get("/", {
      headers: { "User-Agent": "curl/8.7.1 (Windows)" },
    });
    expect(await windowsCurl.text()).toContain("PowerShell + .NET recipe for Windows");
  });

  test("browser home points humans to the root curl flow", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-write"], {
      origin: "http://localhost:15032",
    });
    await page.addInitScript(() => {
      const clipboard = { writeText: () => Promise.resolve() };
      Object.defineProperty(Navigator.prototype, "clipboard", {
        configurable: true,
        get: () => clipboard,
      });
    });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Encrypted HTML links/ })).toBeVisible();
    await expect
      .poll(async () => page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("IBM Plex Sans");
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return Array.from(document.fonts).some(
            (font) => font.family === "IBM Plex Sans" && font.status === "loaded"
          );
        })
      )
      .toBe(true);
    await expect(page.getByText("Tell your agent")).toHaveCount(0);
    await expect(page.getByText("curl askhuman.app and use that")).toHaveCount(0);
    await expect(
      page.getByText("Run curl -s https://askhuman.app and follow the instructions")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "llms.txt" })).toBeVisible();

    const bookmarklet = page.getByRole("link", { name: "askhuman snapshot" });
    await expect(bookmarklet).toBeVisible();
    await expect
      .poll(async () => decodeURIComponent((await bookmarklet.getAttribute("href")) || ""))
      .toContain('const askhumanOrigin = "http://localhost:15032"');
    const href = (await bookmarklet.getAttribute("href")) || "";
    expect(href).toMatch(/^javascript:/);
    const decoded = decodeURIComponent(href.replace(/^javascript:/, ""));
    expect(decoded).toContain('receiverUrl = askhumanOrigin + "/bookmarklet-receiver"');
    expect(decoded).toContain("crypto.subtle");
    expect(decoded).toContain("postMessage");
    expect(decoded).toContain("askhuman.bookmarklet.snapshot");
    expect(decoded).not.toContain('createElement("script")');

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

  test("bookmarklet route serves the encrypted snapshot sender", async ({ request }) => {
    const res = await request.get("/bookmarklet.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/javascript");
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
    const js = await res.text();

    expect(js).toContain("crypto.subtle");
    expect(js).toContain("AES-CBC");
    expect(js).toContain("HMAC");
    expect(js).toContain("CompressionStream");
    expect(js).toContain('compression: "gzip"');
    expect(js).toContain("/bookmarklet-receiver");
    expect(js).toContain("postMessage");
    expect(js).toContain("askhuman.bookmarklet.snapshot");
    expect(js).toContain("document.documentElement.cloneNode(true)");
    expect(js).toContain("getComputedStyle");
    expect(js).toContain("readableStylesheetCss");
    expect(js).toContain("retrying compact snapshot");
    expect(js).toContain("Payload too large after compact snapshot");
    expect(js).not.toContain('createElement("script")');
    expect(js).not.toContain("/review");
    expect(js).not.toContain("/playground");
  });

  test("bookmarklet serializes a styled page for offline viewing", async ({ page }) => {
    await page.goto("/");
    const bookmarklet = page.getByRole("link", { name: "askhuman snapshot" });
    await expect.poll(async () => await bookmarklet.getAttribute("href")).toContain("javascript:");
    const href = (await bookmarklet.getAttribute("href")) || "";
    expect(href).toMatch(/^javascript:/);

    await page.setContent(`<!doctype html>
      <html>
        <head>
          <title>Styled Offline Page</title>
          <style>
            body { margin: 0; background: rgb(246, 247, 248); }
            #styled { color: rgb(12, 34, 56); font-size: 31px; }
          </style>
          <script>document.documentElement.dataset.sourceScript = "ran";</script>
        </head>
        <body>
          <a id="bookmarklet-runner">run</a>
          <h1 id="styled">Styled Snapshot</h1>
          <input id="field" value="captured value">
        </body>
      </html>`);
    await page.locator("#bookmarklet-runner").evaluate((node, href) => {
      node.setAttribute("href", href);
    }, href);

    const popupPromise = page.waitForEvent("popup");
    await page.locator("#bookmarklet-runner").click();
    const popup = await popupPromise;
    await popup.waitForURL((url) => url.pathname.startsWith("/s/") && url.hash.startsWith("#k="));

    const frame = popup.frameLocator("iframe");
    await expect(frame.locator("#styled")).toHaveText("Styled Snapshot");
    await expect(frame.locator("#styled")).toHaveCSS("color", "rgb(12, 34, 56)");
    await expect(frame.locator("#styled")).toHaveCSS("font-size", "31px");
    await expect(frame.locator("#field")).toHaveValue("captured value");
    await expect(frame.locator("script")).toHaveCount(0);
  });

  test("bookmarklet receiver uploads posted ciphertext and redirects to a keyed share", async ({
    page,
  }) => {
    const { payload, key } = await createEncryptedHtmlPayload(AGENT_HTML, {
      filename: "receiver-preview.html",
      title: "Receiver Preview",
    });
    expect(payload.compression).toBe(ENCRYPTED_HTML_COMPRESSION);

    await page.goto("/bookmarklet-receiver");
    await expect(page.getByText("Waiting For Snapshot")).toBeVisible();
    await page.evaluate(
      ({ payload, key }) => {
        const message = { type: "askhuman.bookmarklet.snapshot", payload: { ...payload, key } };
        const interval = window.setInterval(() => {
          window.postMessage(message, window.location.origin);
        }, 100);
        window.setTimeout(() => window.clearInterval(interval), 5000);
        window.postMessage(message, window.location.origin);
      },
      { payload, key }
    );

    await page.waitForURL((url) => url.pathname.startsWith("/s/") && url.hash === `#k=${key}`);
    await expect(page).toHaveTitle("Receiver Preview | askhuman.app");
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#title")).toHaveText("Agent Generated HTML");
  });

  test("bookmarklet receiver reports measured payload size when upload is too large", async ({
    page,
  }) => {
    await page.goto("/bookmarklet-receiver");
    await expect(page.getByText("Waiting For Snapshot")).toBeVisible();
    await page.evaluate(
      ({ maxUploadBytes }) => {
        const payload = {
          version: 1,
          alg: "aes-256-cbc+hmac-sha256",
          title: "Huge Snapshot",
          filename: "huge.html",
          iv: "A".repeat(22),
          ciphertext: "B".repeat(maxUploadBytes),
          mac: "C".repeat(43),
          key: "D".repeat(86),
        };
        const message = { type: "askhuman.bookmarklet.snapshot", payload };
        const interval = window.setInterval(() => {
          window.postMessage(message, window.location.origin);
        }, 100);
        window.setTimeout(() => window.clearInterval(interval), 5000);
        window.postMessage(message, window.location.origin);
      },
      { maxUploadBytes: MAX_UPLOAD_FORM_BYTES }
    );

    await expect(page.getByText("Cannot Create Share")).toBeVisible();
    await expect(page.getByText(/Payload too large:/)).toBeVisible();
    await expect(page.getByText(/bytes\)\. Limit:/)).toBeVisible();
  });

  test("upload responses include CORS headers for bookmarklet requests", async ({ request }) => {
    const res = await request.post("/upload", {
      headers: { Accept: "text/plain", "Content-Type": "text/html" },
      data: AGENT_HTML,
    });

    expect(res.status()).toBe(415);
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
    expect(res.headers()["access-control-allow-methods"]).toContain("POST");
    expect(await res.text()).toContain("multipart/form-data");
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

    const encryptedJson = await request.post("/upload", {
      headers: { ...JSON_ACCEPT, "Content-Type": "application/json" },
      data: {
        version: ENCRYPTED_HTML_VERSION,
        alg: ENCRYPTED_HTML_ALGORITHM,
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      },
    });
    expect(encryptedJson.status()).toBe(415);

    const withPlaintextField = await request.post("/upload", {
      headers: JSON_ACCEPT,
      multipart: {
        version: String(ENCRYPTED_HTML_VERSION),
        alg: ENCRYPTED_HTML_ALGORITHM,
        html: AGENT_HTML,
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      },
    });
    expect(withPlaintextField.status()).toBe(400);
    expect((await withPlaintextField.json()).error).toContain("plaintext");

    const unsupported = await request.post("/upload", {
      headers: JSON_ACCEPT,
      multipart: {
        version: String(ENCRYPTED_HTML_VERSION),
        alg: "plain",
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      },
    });
    expect(unsupported.status()).toBe(400);

    const unsupportedCompression = await request.post("/upload", {
      headers: JSON_ACCEPT,
      multipart: {
        version: String(ENCRYPTED_HTML_VERSION),
        alg: ENCRYPTED_HTML_ALGORITHM,
        compression: "br",
        iv: "abc",
        ciphertext: "abc",
        mac: "abc",
      },
    });
    expect(unsupportedCompression.status()).toBe(400);
    expect((await unsupportedCompression.json()).error).toContain("compression");
  });

  test("legacy endpoints are not supported", async ({ request }) => {
    for (const path of ["/review", "/diff", "/present", "/playground", "/share", "/plan", "/files", "/remark", "/k/example"]) {
      const res = await request.post(path, { headers: JSON_ACCEPT });
      expect(res.status(), path).toBe(404);
    }
  });
});
