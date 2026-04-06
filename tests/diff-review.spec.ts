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

function postThreadAfterDelay(
  request: { post: (url: string, options: { data: { text: string } }) => Promise<unknown> },
  sessionId: string,
  text: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request
        .post(`/session/${sessionId}/threads`, {
          data: { text },
        })
        .then(() => resolve(), reject);
    }, delayMs);
  });
}

test.describe("Diff Review", () => {
  let sessionId: string;
  let hunkIds: number[];

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/diff", {
      data: DIFF,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    sessionId = body.sessionId;
    hunkIds = body.hunks.map((h: { id: number }) => h.id);
  });

  test("submit_diff returns hunk metadata", async ({ request }) => {
    const res = await request.post("/diff", {
      data: DIFF,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(body.hunks).toHaveLength(1);
    expect(body.hunks[0].file).toBe("foo.ts");
    expect(body.hunks[0].oldStart).toBe(1);
    expect(body.hunks[0].newStart).toBe(1);
    expect(body.hunks[0].preview.first).toBeTruthy();
  });

  test("browser shows waiting state before show_hunks", async ({ page }) => {
    const res = await page.request.post("/diff", {
      data: "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n",
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await res.json();
    await page.goto(`/session/${id}`);
    await expect(page.locator("text=Waiting for agent")).toBeVisible();
  });

  test("browser hitting diff poll redirects via proxy", async ({ page }) => {
    await page.goto(`/diff/${sessionId}/poll`);
    await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  });

  test("show_hunks makes diff visible in browser", async ({ page, request }) => {
    await request.post(`/diff/${sessionId}/view`, {
      data: {
        hunkIds,
        description:
          "# Refactored constants\n\n- Updated `y`\n- Added **z** for the new calculation",
      },
      headers: JSON_ACCEPT,
    });

    await page.goto(`/session/${sessionId}`);
    await expect(page.locator("text=Diff Review").first()).toBeVisible();
    await expect(page.locator("main .prose h1")).toHaveText("Refactored constants");
    await expect(page.locator("main .prose li")).toHaveCount(2);
    await expect(page.locator("main .prose code")).toHaveText("y");
    await expect(page.locator("main .prose strong")).toHaveText("z");
    await expect(page.locator("text=foo.ts").first()).toBeVisible();
  });

  test("human posts comment on hunk line", async ({ request }) => {
    const res = await request.post(`/session/${sessionId}/threads`, {
      data: { hunkId: hunkIds[0], line: 3, text: "Why change y?" },
    });
    expect(res.status()).toBe(200);
    const thread = await res.json();
    expect(thread.hunk_id).toBe(hunkIds[0]);
    expect(thread.line).toBe(3);
    expect(thread.messages[0].text).toBe("Why change y?");
  });

  test("human posts general comment", async ({ request }) => {
    const res = await request.post(`/session/${sessionId}/threads`, {
      data: { text: "LGTM" },
    });
    expect(res.status()).toBe(200);
    const thread = await res.json();
    expect(thread.hunk_id).toBeNull();
    expect(thread.line).toBeNull();
  });

  test("agent receives comments via poll", async ({ request }) => {
    const res = await request.post("/diff", {
      data: DIFF,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const { sessionId: id, hunks } = await res.json();
    await request.post(`/diff/${id}/view`, {
      data: { hunkIds: hunks.map((h: { id: number }) => h.id), description: "Review" },
      headers: JSON_ACCEPT,
    });
    await request.post(`/session/${id}/threads`, {
      data: { hunkId: hunks[0].id, line: 2, text: "Feedback" },
    });
    const pollRes = await request.get(`/diff/${id}/poll`, {
      headers: JSON_ACCEPT,
    });
    const body = await pollRes.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("Feedback");
  });

  test("agent replies to thread", async ({ request }) => {
    const threadRes = await request.post(`/session/${sessionId}/threads`, {
      data: { hunkId: hunkIds[0], line: 4, text: "Why add z?" },
    });
    const thread = await threadRes.json();

    const delayedComment = postThreadAfterDelay(
      request,
      sessionId,
      "Follow-up on diff"
    );
    const res = await request.post(`/diff/${sessionId}/reply`, {
      data: { replies: [{ threadId: thread.id, text: "Needed for calc." }] },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sent[0].text).toBe("Needed for calc.");
    expect(body.status).toBe("comments");
  });

  test("show_hunks updates browser via WebSocket", async ({ page, request }) => {
    const res = await request.post("/diff", {
      data: `diff --git a/a.ts b/a.ts
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
`,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const { sessionId: id, hunks } = await res.json();
    expect(hunks).toHaveLength(2);

    // Show first hunk
    await request.post(`/diff/${id}/view`, {
      data: { hunkIds: [hunks[0].id], description: "First file" },
      headers: JSON_ACCEPT,
    });

    await page.goto(`/session/${id}`);
    await expect(page.locator("text=First file")).toBeVisible();
    await expect(page.locator("text=a.ts").first()).toBeVisible();

    // Show second hunk — browser should reload via WebSocket
    await request.post(`/diff/${id}/view`, {
      data: { hunkIds: [hunks[1].id], description: "Second file" },
      headers: JSON_ACCEPT,
    });

    await expect(page.locator("text=Second file")).toBeVisible({ timeout: 10000 });
  });

  test("show_hunks rejects multi-hunk views over 200 lines", async ({ request }) => {
    const res = await request.post("/diff", {
      data: `${makeAddedHunkDiff("large-a.ts", 120)}${makeAddedHunkDiff("large-b.ts", 120)}`,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const { sessionId: id, hunks } = await res.json();

    const viewRes = await request.post(`/diff/${id}/view`, {
      data: {
        hunkIds: hunks.map((h: { id: number }) => h.id),
        description: "Too many lines",
      },
      headers: JSON_ACCEPT,
    });

    expect(viewRes.status()).toBe(400);
    const body = await viewRes.json();
    expect(body.error).toContain("totaling 240 lines");
    expect(body.error).toContain("limited to 200 lines");
    expect(body.error).toContain("Split this into smaller batches");
  });

  test("show_hunks validates the request body with zod", async ({ request }) => {
    const viewRes = await request.post(`/diff/${sessionId}/view`, {
      data: {
        hunkIds: [],
        description: 123,
      },
      headers: JSON_ACCEPT,
    });

    expect(viewRes.status()).toBe(400);
    const body = await viewRes.json();
    expect(body.error).toBe("Invalid show_hunks payload.");
    expect(body.issues.fieldErrors.hunkIds).toBeTruthy();
    expect(body.issues.fieldErrors.description).toBeTruthy();
  });

  test("show_hunks allows a single hunk over 200 lines", async ({ page, request }) => {
    const res = await request.post("/diff", {
      data: makeAddedHunkDiff("large-single.ts", 220),
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const { sessionId: id, hunks } = await res.json();
    expect(hunks).toHaveLength(1);

    const viewRes = await request.post(`/diff/${id}/view`, {
      data: {
        hunkIds: [hunks[0].id],
        description: "Single large hunk",
      },
      headers: JSON_ACCEPT,
    });

    expect(viewRes.status()).toBe(200);
    await page.goto(`/session/${id}`);
    await expect(page.locator("text=Single large hunk")).toBeVisible();
    await expect(page.locator("text=large-single.ts").first()).toBeVisible();
  });

  test("multi-hunk diff returns all hunks", async ({ request }) => {
    const res = await request.post("/diff", {
      data: `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
@@ -10 +10 @@
-c
+d
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-e
+f
`,
      headers: { "Content-Type": "text/plain", ...JSON_ACCEPT },
    });
    const body = await res.json();
    expect(body.hunks).toHaveLength(3);
    expect(body.hunks[0].file).toBe("a.ts");
    expect(body.hunks[1].file).toBe("a.ts");
    expect(body.hunks[2].file).toBe("b.ts");
  });

  test("diff endpoint returns markdown by default", async ({ request }) => {
    const res = await request.post("/diff", {
      data: DIFF,
      headers: { "Content-Type": "text/plain" },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/markdown");
    await expect(res.text()).resolves.toContain("# Diff Review Session");
  });
});
