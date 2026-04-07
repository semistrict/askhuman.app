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

function postThreadAfterDelay(
  request: { post: (url: string, options: { data: Record<string, unknown> }) => Promise<unknown> },
  sessionId: string,
  text: string,
  filePath?: string,
  line?: number,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request
        .post(`/s/${sessionId}/threads`, {
          data: { text, filePath, line },
        })
        .then(() => resolve(), reject);
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
    expect(body.message).toContain("/files/" + body.sessionId + "/reply");
    expect(body.message).toContain("2 file(s)");
  });

  test("browser shows file selector and file content", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    await page.goto(`/s/${sessionId}`);

    await expect(page.getByText("File Review")).toBeVisible();
    // File selector shows both files
    await expect(page.locator("nav button", { hasText: "src/greet.ts" })).toBeVisible();
    await expect(page.locator("nav button", { hasText: "README.md" })).toBeVisible();
    // First file should be selected by default
    await expect(page.locator("text=const greet")).toBeVisible();
  });

  test("clicking a file in the selector shows its content", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });
    await page.goto(`/s/${sessionId}`);

    // Click README.md in the file selector
    await page.locator("nav button", { hasText: "README.md" }).click();
    await expect(page.locator("text=This is a sample project")).toBeVisible();
  });

  test("poll returns comments when human posts thread", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(
      request, sessionId, "Nice function", "src/greet.ts", 1
    );
    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;

    expect(pollRes.status()).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("Nice function");
  });

  test("reply works and auto-polls", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(
      request, sessionId, "Add a return type"
    );
    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;
    const pollBody = await pollRes.json();
    const threadId = pollBody.threads[0].id as number;

    const delayedDone = postDoneAfterDelay(request, sessionId);
    const replyRes = await request.post(`/files/${sessionId}/reply`, {
      multipart: {
        threadId: String(threadId),
        text: "Done.",
      },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;

    expect(replyRes.status()).toBe(200);
    const replyBody = await replyRes.json();
    expect(replyBody.sent[0].text).toBe("Done.");
  });

  test("resubmit removes files not included and marks comments outdated", async ({ request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
      "README.md": FILE_B,
    });

    // Post a thread on README.md
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Update the readme", filePath: "README.md", line: 1 },
    });

    // Resubmit without README.md
    const updateRes = await request.post("/files", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        "src/greet.ts": FILE_A,
      },
    });
    expect(updateRes.status()).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.message).toContain("outdated");
    expect(updateBody.message).toContain("1 file(s)");
  });

  test("done marks session complete", async ({ page, request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await page.goto(`/s/${sessionId}`);

    const doneRes = await request.post(`/s/${sessionId}/done`);
    expect(doneRes.status()).toBe(200);
    expect((await doneRes.json()).done).toBe(true);

    const pollRes = await request.get(`/files/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
    });
    expect((await pollRes.json()).status).toBe("done");
  });

  test("resubmit to completed session is rejected", async ({ request }) => {
    const { sessionId } = await createFileSession(request, {
      "src/greet.ts": FILE_A,
    });
    await request.post(`/s/${sessionId}/done`);

    const res = await request.post("/files", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        "src/greet.ts": FILE_A,
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("already complete");
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
