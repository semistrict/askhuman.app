import { expect, test } from "@playwright/test";

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

function desc(diff: string, title: string, body: string): string {
  const diffLines = diff.split("\n").length;
  const minProse = Math.ceil(diffLines * 0.05);
  const lines = [`# ${title}`, "", body];
  while (lines.filter((line) => line.trim().length > 0 && !line.startsWith("#")).length < minProse) {
    lines.push("This change is part of the ongoing refactor.");
  }
  return lines.join("\n");
}

async function startDiffSession(request: { post: Function }) {
  const res = await request.post("/diff", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitDiffSession(
  sessionId: string,
  description: string,
  diff: string,
  extra: Record<string, string> = {}
) {
  const formData = new FormData();
  formData.set("description", description);
  formData.set("diff", diff);
  for (const [key, value] of Object.entries(extra)) {
    formData.set(key, value);
  }
  return fetch(`http://localhost:15032/diff/${sessionId}`, {
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

test.describe("Diff Review", () => {
  test("starts a diff session and returns the next action endpoint", async ({ request }) => {
    const body = await startDiffSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("Chrome app mode");
    expect(body.next).toContain(`/diff/${body.sessionId}`);
  });

  test("bootstrap rejects diff payloads on the root endpoint", async ({ request }) => {
    const res = await request.post("/diff", {
      headers: JSON_ACCEPT,
      multipart: {
        description: desc(DIFF, "Wrong shape", "This should not be accepted on the bootstrap endpoint."),
        diff: DIFF,
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("POST /diff only creates an empty diff review session");
  });

  test("browser shows the uploaded diff after the action call initializes the session", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDiffSession(
      sessionId,
      desc(DIFF, "Refactored constants", "Updated y and added z to the exports module."),
      DIFF
    );

    await expect(page.getByRole("heading", { name: "Refactored constants" })).toBeVisible();
    await expect(page.getByText("const z = 4;")).toBeVisible();

    await request.post(`/s/${sessionId}/done`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("action waits for review completion and returns comments after Done", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDiffSession(
      sessionId,
      desc(DIFF, "Review", "Please review the constant changes in foo.ts."),
      DIFF
    );

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Looks good" },
    });
    await request.post(`/s/${sessionId}/done`);

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Looks good");
  });

  test("standalone poll still works after a diff session is initialized", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDiffSession(
      sessionId,
      desc(DIFF, "Review", "Reviewing the constant value changes."),
      DIFF
    );

    await expect(page.getByText("const z = 4;")).toBeVisible();

    const delayedDone = postDoneAfterDelay(request, sessionId, 250);
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;

    expect((await pollRes.json()).status).toBe("done");
    await actionPromise;
  });

  test("updating the same diff session resets done and marks older comments outdated", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const initialAction = submitDiffSession(
      sessionId,
      desc(DIFF, "Initial review", "Reviewing the first version of the constants change."),
      DIFF
    );
    await expect(page.getByText("const z = 4;")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, { data: { text: "Fix the import" } });
    await request.post(`/s/${sessionId}/done`);
    await initialAction;

    const UPDATED_DIFF = `diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 10;
+const z = 4;
 export { x };
`;

    const updatePromise = submitDiffSession(
      sessionId,
      desc(UPDATED_DIFF, "Updated review", "Adjusted the y constant after the first round of comments."),
      UPDATED_DIFF
    );

    await expect(page.getByRole("heading", { name: "Updated review" })).toBeVisible();
    await expect(page.getByText("Fix the import")).toBeVisible();
    await request.post(`/s/${sessionId}/done`);

    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("all-additions markdown hunks render as markdown-style review", async ({ page, request }) => {
    const markdownDiff = `diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,4 @@
+# Getting Started
+
+- Install dependencies
+- Run tests
`;

    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);
    const actionPromise = submitDiffSession(
      sessionId,
      desc(markdownDiff, "Documentation", "Adding a getting started guide for new contributors."),
      markdownDiff
    );

    await expect(page.locator('[data-hunk-rendering="markdown-additions"]')).toBeVisible();
    await expect(
      page.locator('[data-hunk-rendering="markdown-additions"]').getByText("Getting Started")
    ).toBeVisible();
    await request.post(`/s/${sessionId}/done`);
    await actionPromise;
  });

  test("rejects descriptions with too little prose on the action endpoint", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const res = await request.post(`/diff/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: {
        description: "# Title",
        diff: DIFF,
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("5%");
  });
});
