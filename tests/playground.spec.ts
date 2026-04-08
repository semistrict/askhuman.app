import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const SIMPLE_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1 id="title">My Playground</h1>
  <input id="name" placeholder="Enter name" />
  <button id="submit" onclick="
    var name = document.getElementById('name').value;
    window.parent.postMessage({ type: 'askhuman:result', data: JSON.stringify({ name: name }) }, '*');
  ">Submit</button>
</body>
</html>`;

const UPDATED_HTML = `<!DOCTYPE html>
<html>
<body>
  <h1 id="title">Updated Playground</h1>
  <p>Version 2</p>
</body>
</html>`;

async function createPlayground(request: { post: Function }, html: string) {
  const res = await request.post("/playground", {
    headers: JSON_ACCEPT,
    multipart: { html },
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

function postDoneAfterDelay(
  request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> },
  sessionId: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request
        .post(`/s/${sessionId}/done`)
        .then(() => resolve(), reject);
    }, delayMs);
  });
}

test.describe("Playground", () => {
  test("creates a playground session", async ({ request }) => {
    const body = await createPlayground(request, SIMPLE_HTML);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("/playground/" + body.sessionId + "/poll");
  });

  test("browser renders HTML in iframe", async ({ page, request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);

    await expect(page.getByText("Playground")).toBeVisible();
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#title")).toHaveText("My Playground");
  });

  test("postMessage result is stored and returned on poll", async ({ page, request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);

    const iframe = page.frameLocator("iframe");
    await iframe.locator("#name").fill("Alice");
    await iframe.locator("#submit").click();

    // Wait for result to be persisted
    await page.waitForTimeout(200);

    // Click Done
    const delayedDone = postDoneAfterDelay(request, sessionId, 300);
    await page.locator("aside").getByRole("button", { name: "Done" }).click();

    const pollRes = await request.get(`/playground/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;

    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.result).toContain("Alice");
  });

  test("poll returns comments alongside result", async ({ page, request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "This is great" },
    });
    await request.post(`/s/${sessionId}/done`);

    const pollRes = await request.get(`/playground/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
    });
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("This is great");
  });

  test("update replaces HTML and resets done", async ({ page, request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);
    await request.post(`/s/${sessionId}/done`);

    // Update
    const updateRes = await request.post("/playground", {
      headers: JSON_ACCEPT,
      multipart: { sessionId, html: UPDATED_HTML },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).message).toContain("updated");

    // Poll should wait (not immediately return done)
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const pollRes = await request.get(`/playground/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;
    expect((await pollRes.json()).status).toBe("done");
  });

  test("done session shows read-only state", async ({ page, request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Looks good" },
    });
    await request.post(`/s/${sessionId}/done`);

    await page.goto(`/s/${sessionId}`);
    // Content visible
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#title")).toHaveText("My Playground");
    // Comment visible
    await expect(page.locator("text=Looks good")).toBeVisible();
    // Done notice shown, buttons gone
    await expect(page.locator("text=Waiting for the agent to update this session.")).toBeVisible();
    await expect(page.locator("button", { hasText: "Done" })).not.toBeVisible();
  });

  test("empty html submission is rejected", async ({ request }) => {
    const res = await request.post("/playground", {
      headers: JSON_ACCEPT,
      multipart: { html: "" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("html");
  });

  test("poll markdown includes result", async ({ request }) => {
    const { sessionId } = await createPlayground(request, SIMPLE_HTML);

    // Store a result directly
    await request.post(`/s/${sessionId}/result`, {
      data: '{"color":"blue"}',
    });
    await request.post(`/s/${sessionId}/done`);

    const res = await request.get(`/playground/${sessionId}/poll`);
    const text = await res.text();
    expect(text).toContain("## Result");
    expect(text).toContain('"color":"blue"');
  });
});
