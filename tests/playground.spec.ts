import { expect, test } from "@playwright/test";

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

async function startPlaygroundSession(request: { post: Function }) {
  const res = await request.post("/playground", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitPlaygroundSession(sessionId: string, html: string) {
  const formData = new FormData();
  formData.set("html", html);
  return fetch(`http://localhost:15032/playground/${sessionId}`, {
    method: "POST",
    headers: JSON_ACCEPT,
    body: formData,
  });
}

function postDoneAfterDelay(
  request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> },
  sessionId: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request.post(`/s/${sessionId}/done`).then(() => resolve(), reject);
    }, delayMs);
  });
}

test.describe("Playground", () => {
  test("starts a playground session and returns the nested action endpoint", async ({
    request,
  }) => {
    const body = await startPlaygroundSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("Chrome app mode");
    expect(body.next).toContain(`/playground/${body.sessionId}`);
  });

  test("browser renders submitted HTML in the iframe", async ({ page, request }) => {
    const { sessionId } = await startPlaygroundSession(request);
    const actionPromise = submitPlaygroundSession(sessionId, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);

    await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("#title")).toHaveText("My Playground");

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("playground action returns stored result and comments after Done", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPlaygroundSession(request);
    const actionPromise = submitPlaygroundSession(sessionId, SIMPLE_HTML);
    await page.goto(`/s/${sessionId}`);

    const iframe = page.frameLocator("iframe");
    await iframe.locator("body").evaluate(() => {
      window.parent.postMessage(
        { type: "askhuman:result", data: JSON.stringify({ name: "Alice" }) },
        "*"
      );
    });
    await request.post(`/s/${sessionId}/threads`, { data: { text: "This is great" } });
    await request.post(`/s/${sessionId}/done`);

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.result).toContain("Alice");
    expect(body.threads[0].messages[0].text).toBe("This is great");
  });

  test("standalone poll is rejected while another agent waiter is already active", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPlaygroundSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitPlaygroundSession(sessionId, SIMPLE_HTML);
    await expect(page.frameLocator("iframe").locator("#title")).toHaveText("My Playground");

    const pollRes = await request.get(`/playground/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    expect(pollRes.status()).toBe(409);
    expect((await pollRes.json()).error).toContain("already waiting");
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("updating the same playground session replaces HTML and reopens review", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startPlaygroundSession(request);
    await page.goto(`/s/${sessionId}`);

    const initialAction = submitPlaygroundSession(sessionId, SIMPLE_HTML);
    await expect(page.frameLocator("iframe").locator("#title")).toHaveText("My Playground");
    await request.post(`/s/${sessionId}/done`);
    await initialAction;

    const updatePromise = submitPlaygroundSession(sessionId, UPDATED_HTML);
    await page.reload();
    await expect(page.frameLocator("iframe").locator("#title")).toHaveText("Updated Playground");
    await expect(page.frameLocator("iframe").getByText("Version 2")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);

    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("action returns an error if the user never opens the page", async ({ request }) => {
    const { sessionId, url } = await startPlaygroundSession(request);
    const actionRes = await request.post(`/playground/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: { html: SIMPLE_HTML },
      timeout: 15000,
    });
    expect(actionRes.status()).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("error");
    expect(body.url).toBe(url);
    expect(body.message).toContain("has not connected yet");
  });

  test("empty html submission is rejected on the action endpoint", async ({ request }) => {
    const { sessionId } = await startPlaygroundSession(request);
    const res = await request.post(`/playground/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: { html: "" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("html");
  });
});
