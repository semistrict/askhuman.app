import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const FILE_A = `const greet = (name: string) => {
  return \`Hello, \${name}!\`;
};

export { greet };
`;

const FILE_B = `# README

This is a sample project.

## Getting Started

Run \`npm install\` to get started.
`;

async function startFileSession(request: { post: Function }) {
  const res = await request.post("/review", {
    headers: JSON_ACCEPT,
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitFileSession(
  sessionId: string,
  files: Record<string, string>,
  extra: Record<string, string> = {}
) {
  const formData = new FormData();
  for (const [path, content] of Object.entries(files)) {
    formData.set(path, content);
  }
  for (const [key, value] of Object.entries(extra)) {
    formData.set(key, value);
  }
  return fetch(`http://localhost:15032/review/${sessionId}`, {
    method: "POST",
    headers: JSON_ACCEPT,
    body: formData,
  });
}

function postThreadAndDoneAfterDelay(
  request: { post: (url: string, options?: { data?: Record<string, unknown> }) => Promise<unknown> },
  sessionId: string,
  text: string,
  filePath?: string,
  line?: number,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(async () => {
      try {
        await request.post(`/s/${sessionId}/threads`, {
          data: { text, filePath, line },
        });
        await request.post(`/s/${sessionId}/done`);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, delayMs);
  });
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

test.describe("File Review", () => {
  test("creates a file session with multiple files", async ({ request }) => {
    const body = await startFileSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("Chrome app mode");
    expect(body.next).toContain(`/review/${body.sessionId}`);
  });

  test("browser shows file selector and file content", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });

    await expect(page.getByText("File Review")).toBeVisible();
    await expect(page.locator("nav button", { hasText: "src/greet.ts" })).toBeVisible();
    await expect(page.locator("nav button", { hasText: "README.md" })).toBeVisible();
    await expect(page.locator("text=const greet")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("single-file review hides the file selector sidebar", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });

    await expect(page.locator("nav")).toHaveCount(0);
    await expect(page.getByText("const greet")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("clicking a file in the selector shows its content", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });

    await expect(page.getByText("const greet")).toBeVisible();
    await expect(page.getByText("Agent waiting")).toBeVisible();
    await page.locator("nav button", { hasText: "README.md" }).click();
    await expect(page.locator("text=This is a sample project")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("markdown files render as markdown", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "README.md": FILE_B,
    });

    await expect(page.locator("text=README").first()).toBeVisible();
    await expect(page.locator("text=Getting Started").first()).toBeVisible();
    await request.post(`/s/${sessionId}/request-revision`);
    await actionPromise;
  });

  test("shows agent presence while a review poll is in flight", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });

    await expect(page.getByText("Agent waiting")).toBeVisible({ timeout: 5000 });

    await request.post(`/s/${sessionId}/done`);
    await actionPromise;

    await expect(page.getByText("No agent connected")).toBeVisible({ timeout: 5000 });
  });

  test("shows the human reviewer name from settings in presence", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);

    await page.addInitScript(() => {
      window.localStorage.setItem(
        "askhuman.settings",
        JSON.stringify({
          enablePostHogMonitoring: false,
          userName: "Ramon",
          generatedUserName: "",
        })
      );
    });

    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.getByRole("button", { name: "Your name: Ramon" })).toBeVisible({
      timeout: 5000,
    });
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("reviewer name updates live across connected tabs and the badge opens settings", async ({
    page,
    context,
    request,
  }) => {
    const { sessionId } = await startFileSession(request);

    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await page.getByLabel("Settings").click();
    await page.getByRole("textbox", { name: "Your name" }).fill("Ramon");
    await page.getByRole("button", { name: "Close" }).click();

    const secondPage = await context.newPage();
    await secondPage.goto(`/s/${sessionId}`);
    await expect(page.getByRole("button", { name: "Your name: Ramon" })).toBeVisible({
      timeout: 5000,
    });
    await expect(secondPage.getByRole("button", { name: "Your name: Ramon" })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: "Your name: Ramon" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("textbox", { name: "Your name" }).fill("Avery");
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByRole("button", { name: "Your name: Avery" })).toBeVisible({
      timeout: 5000,
    });
    await expect(secondPage.getByRole("button", { name: "Your name: Avery" })).toBeVisible({
      timeout: 5000,
    });

    await secondPage.close();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("different humans get different deterministic presence pill colors", async ({
    browser,
    page,
    request,
  }) => {
    const { sessionId } = await startFileSession(request);

    await page.addInitScript(() => {
      window.localStorage.setItem(
        "askhuman.settings",
        JSON.stringify({
          enablePostHogMonitoring: false,
          userName: "Ramon",
          generatedUserName: "",
        })
      );
    });
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.addInitScript(() => {
      window.localStorage.setItem(
        "askhuman.settings",
        JSON.stringify({
          enablePostHogMonitoring: false,
          userName: "Avery",
          generatedUserName: "",
        })
      );
    });
    await otherPage.goto(`/s/${sessionId}`);

    const ramon = page.getByRole("button", { name: "Your name: Ramon" });
    const avery = page.getByRole("button", { name: "Connected human: Avery" });
    await expect(ramon).toBeVisible({ timeout: 5000 });
    await expect(avery).toBeVisible({ timeout: 5000 });

    const ramonStyle = await ramon.getAttribute("style");
    const averyStyle = await avery.getAttribute("style");
    expect(ramonStyle).toBeTruthy();
    expect(averyStyle).toBeTruthy();
    expect(ramonStyle).not.toBe(averyStyle);

    await otherContext.close();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("poll returns comments only after Done is clicked", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });

    await expect(page.getByText("const greet")).toBeVisible();

    const delayedAction = postThreadAndDoneAfterDelay(
      request, sessionId, "Nice function", "src/greet.ts", 1
    );
    const pollRes = await actionPromise;
    await delayedAction;

    expect(pollRes.status).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Nice function");
  });

  test("resubmit removes files not included and marks comments outdated", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const initialAction = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    await expect(page.getByText("File Review")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Update the readme", filePath: "README.md", line: 1 },
    });

    await request.post(`/s/${sessionId}/done`);
    await initialAction;

    const updatePromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.locator("text=const greet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await page.locator("aside").getByRole("button", { name: "Done" }).click();
    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("resubmit to done session resets done state", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const initialAction = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.locator("text=const greet")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    await initialAction;

    const updatePromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.locator("text=const greet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("done marks session complete", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.locator("text=const greet")).toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect((await actionRes.json()).status).toBe("done");
  });

  test("reopening done session shows content with buttons disabled", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": FILE_A,
    });
    await expect(page.locator("text=const greet")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Add types", filePath: "src/greet.ts", line: 1 },
    });
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;

    await page.goto(`/s/${sessionId}`);
    // File content visible
    await expect(page.locator("text=const greet")).toBeVisible();
    // Comment visible in panel
    await expect(page.locator("aside").getByText("Add types")).toBeVisible();
    // Done notice shown, buttons gone
    await expect(page.locator("text=Waiting for the agent to update this session.")).toBeVisible();
    await expect(page.locator("button", { hasText: "Done" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Comment" })).not.toBeVisible();
  });

  test("poll markdown includes file context around line comments", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": "line1\nline2\nline3\nline4\nline5",
    });
    await expect(page.locator("text=line3")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Fix line 3", filePath: "src/greet.ts", line: 3 },
    });
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;

    const res = await request.get(`/review/${sessionId}/poll`);
    const text = await res.text();
    expect(text).toContain("#1 (src/greet.ts:3)");
    expect(text).toContain("> ");
    expect(text).toContain("line3");
    // Context lines
    expect(text).toContain("line2");
    expect(text).toContain("line4");
    expect(text).toContain("Fix line 3");
  });

  test("poll markdown shows context for edge lines", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "edge.ts": "first\nsecond",
    });
    await expect(page.locator("text=first")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Comment on first line", filePath: "edge.ts", line: 1 },
    });
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;

    const res = await request.get(`/review/${sessionId}/poll`);
    const text = await res.text();
    expect(text).toContain("#1 (edge.ts:1)");
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).toContain("Comment on first line");
  });

  test("poll markdown shows general comments without context", async ({ page, request }) => {
    const { sessionId } = await startFileSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitFileSession(sessionId, {
      "src/greet.ts": "content",
    });
    await expect(page.locator("text=content")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Overall looks good" },
    });
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;

    const res = await request.get(`/review/${sessionId}/poll`);
    const text = await res.text();
    expect(text).toContain("#1 (general)");
    expect(text).toContain("Overall looks good");
  });

  test("empty file submission is rejected", async ({ request }) => {
    const { sessionId } = await startFileSession(request);
    const res = await request.post(`/review/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: {
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("No files provided");
  });
});
