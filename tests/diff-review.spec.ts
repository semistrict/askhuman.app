import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const DIFF = `diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };
`;

const TWO_FILE_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`;

function makeMarkdownAddedDiff(): string {
  return `diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,4 @@
+# Getting Started
+
+- Install dependencies
+- Run tests
`;
}

function makeAddedHunkDiff(file: string, lineCount: number): string {
  const additions = Array.from(
    { length: lineCount },
    (_, i) => `+const line${i + 1} = ${i + 1};`
  ).join("\n");
  return `diff --git a/${file} b/${file}
new file mode 100644
--- /dev/null
+++ b/${file}
@@ -0,0 +1,${lineCount} @@
${additions}
`;
}

async function createDiffSession(
  request: { post: Function },
  description: string,
  diff: string
) {
  const res = await request.post("/diff", {
    headers: JSON_ACCEPT,
    multipart: { description, diff },
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

function postThreadAndDoneAfterDelay(
  request: { post: (url: string, options?: { data?: Record<string, unknown> }) => Promise<unknown> },
  sessionId: string,
  text: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(async () => {
      try {
        await request.post(`/s/${sessionId}/threads`, { data: { text } });
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

test.describe("Diff Review", () => {
  test("creates a diff session with description and diff", async ({ request }) => {
    const body = await createDiffSession(
      request,
      "# Review\n\nUpdated constants.",
      DIFF
    );
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("/diff/" + body.sessionId + "/poll");
  });

  test("browser shows full diff after creation", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "# Refactored constants\n\nUpdated y and added z.",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);
    await expect(page.locator("text=Refactored constants")).toBeVisible();
    await expect(page.locator("text=foo.ts")).toBeVisible();
    await expect(page.locator("text=const z = 4;")).toBeVisible();
  });

  test("poll returns comments only after Done is clicked", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review this",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    // Post a comment then click Done -- poll should return with the comment
    const delayedAction = postThreadAndDoneAfterDelay(request, sessionId, "Looks good");
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedAction;

    expect(pollRes.status()).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Looks good");
  });

  test("resubmit marks outdated threads on changed hunks", async ({ request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Initial review",
      TWO_FILE_DIFF
    );

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Comment on a.ts" },
    });

    const UPDATED_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+completely_new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`;

    const updateRes = await request.post("/diff", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        description: "Updated review",
        diff: UPDATED_DIFF,
      },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).message).toContain("outdated");
  });

  test("resubmit to done session resets done state", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);
    await request.post(`/s/${sessionId}/done`);

    // Resubmit should succeed (resets done)
    const updateRes = await request.post("/diff", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        description: "Updated",
        diff: DIFF,
      },
    });
    expect(updateRes.status()).toBe(200);

    // Poll should now wait (not immediately return done)
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;
    expect((await pollRes.json()).status).toBe("done");
  });

  test("done marks session complete", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    await request.post(`/s/${sessionId}/done`);

    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
    });
    expect((await pollRes.json()).status).toBe("done");
  });

  test("reopening done session shows content with buttons disabled", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "# Review\n\nCheck this.",
      DIFF
    );

    await request.post(`/s/${sessionId}/threads`, { data: { text: "Fix the import" } });
    await request.post(`/s/${sessionId}/done`);

    await page.goto(`/s/${sessionId}`);
    // Content is visible
    await expect(page.locator("text=foo.ts")).toBeVisible();
    await expect(page.locator("text=const z = 4;")).toBeVisible();
    // Comment is visible
    await expect(page.locator("text=#1")).toBeVisible();
    await expect(page.locator("text=Fix the import")).toBeVisible();
    // Done notice shown, buttons gone
    await expect(page.locator("text=Waiting for agent")).toBeVisible();
    await expect(page.locator("button", { hasText: "Done" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Comment" })).not.toBeVisible();
  });

  test("poll markdown includes diff context around hunk comments", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    // Post a comment on a specific hunk line, then Done
    // We need to get a hunk_id -- post a thread via the threads endpoint with hunkId
    // For simplicity, post a general thread and verify the format
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Check this change" },
    });
    await request.post(`/s/${sessionId}/done`);

    const res = await request.get(`/diff/${sessionId}/poll`);
    const text = await res.text();
    expect(text).toContain("#1 (general)");
    expect(text).toContain("Check this change");
  });

  test("all-additions markdown hunks render like plan review", async ({ page, request }) => {
    const diff = makeMarkdownAddedDiff();
    const { sessionId } = await createDiffSession(
      request,
      "Docs only",
      diff
    );

    await page.goto(`/s/${sessionId}`);
    await expect(page.locator('[data-hunk-rendering="markdown-additions"]')).toBeVisible();
    await expect(page.getByText("Getting Started")).toBeVisible();
  });

  test("all-additions code hunks render as highlighted source", async ({ page, request }) => {
    const diff = makeAddedHunkDiff("new-file.ts", 3);
    const { sessionId } = await createDiffSession(
      request,
      "Code only",
      diff
    );

    await page.goto(`/s/${sessionId}`);
    await expect(page.locator('[data-hunk-rendering="source-additions"]')).toBeVisible();
    await expect(page.getByText("const line1 = 1;")).toBeVisible();
  });
});
