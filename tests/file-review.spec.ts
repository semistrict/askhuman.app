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

async function createFileSession(
  request: { post: Function },
  files: Record<string, string>
) {
  const multipart: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    multipart[path] = content;
  }
  const res = await request.post("/files", {
    headers: JSON_ACCEPT,
    multipart,
  });
  expect(res.status()).toBe(200);
  return await res.json();
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
    const body = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("/files/" + body.sessionId + "/poll");
    expect(body.message).toContain("2 file(s)");
  });

  test("browser shows file selector and file content", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    await page.goto(`/s/${sessionId}`);

    await expect(page.getByText("File Review")).toBeVisible();
    await expect(page.locator("nav button", { hasText: "src/greet.ts" })).toBeVisible();
    await expect(page.locator("nav button", { hasText: "README.md" })).toBeVisible();
    await expect(page.locator("text=const greet")).toBeVisible();
  });

  test("clicking a file in the selector shows its content", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    await page.goto(`/s/${sessionId}`);

    await page.locator("nav button", { hasText: "README.md" }).click();
    await expect(page.locator("text=This is a sample project")).toBeVisible();
  });

  test("poll returns comments only after Done is clicked", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);

    const delayedAction = postThreadAndDoneAfterDelay(
      request, sessionId, "Nice function", "src/greet.ts", 1
    );
    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedAction;

    expect(pollRes.status()).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Nice function");
  });

  test("resubmit removes files not included and marks comments outdated", async ({ request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Update the readme", filePath: "README.md", line: 1 },
    });

    const updateRes = await request.post("/files", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        "src/greet.ts": FILE_A,
      },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).message).toContain("outdated");
  });

  test("resubmit to done session resets done state", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);
    await request.post(`/s/${sessionId}/done`);

    // Resubmit should succeed
    const updateRes = await request.post("/files", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        "src/greet.ts": FILE_A,
      },
    });
    expect(updateRes.status()).toBe(200);

    // Poll should wait again
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;
    expect((await pollRes.json()).status).toBe("done");
  });

  test("done marks session complete", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);

    await request.post(`/s/${sessionId}/done`);

    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
    });
    expect((await pollRes.json()).status).toBe("done");
  });

  test("reopening done session shows content with buttons disabled", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Add types", filePath: "src/greet.ts", line: 1 },
    });
    await request.post(`/s/${sessionId}/done`);

    await page.goto(`/s/${sessionId}`);
    // File content visible
    await expect(page.locator("text=const greet")).toBeVisible();
    // Comment visible in panel
    await expect(page.locator("aside").getByText("Add types")).toBeVisible();
    // Done notice shown, buttons gone
    await expect(page.locator("text=Waiting for agent")).toBeVisible();
    await expect(page.locator("button", { hasText: "Done" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Comment" })).not.toBeVisible();
  });

  test("empty file submission is rejected", async ({ request }) => {
    const res = await request.post("/files", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId: "",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("No files provided");
  });
});
