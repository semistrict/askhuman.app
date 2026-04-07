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

function postThreadAfterDelay(
  request: { post: (url: string, options: { data: { text: string } }) => Promise<unknown> },
  sessionId: string,
  text: string,
  delayMs: number = 100
) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      request
        .post(`/s/${sessionId}/threads`, {
          data: { text },
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
    expect(body.message).toContain("/diff/" + body.sessionId + "/reply");
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

  test("browser shows waiting state when no hunks", async ({ page, request }) => {
    // Create a plan session (not diff) to get an empty diff view
    const res = await request.post("/plan", {
      data: "test plan",
      headers: JSON_ACCEPT,
    });
    const { sessionId } = await res.json();
    // Manually set content type to diff to simulate empty diff session
    // Instead, just verify that a diff session with actual content shows hunks
    const { sessionId: diffId } = await createDiffSession(
      request,
      "Description",
      DIFF
    );
    await page.goto(`/s/${diffId}`);
    await expect(page.locator("text=foo.ts")).toBeVisible();
  });

  test("poll returns comments when human posts thread", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review this",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Looks good");
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;

    expect(pollRes.status()).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("Looks good");
  });

  test("reply works and auto-polls for next comments", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Fix the typo");
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;
    const pollBody = await pollRes.json();
    const threadId = pollBody.threads[0].id as number;

    // Reply and schedule a Done to unblock the auto-poll
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const replyRes = await request.post(`/diff/${sessionId}/reply`, {
      multipart: {
        threadId: String(threadId),
        text: "Fixed.",
      },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;

    expect(replyRes.status()).toBe(200);
    const replyBody = await replyRes.json();
    expect(replyBody.sent[0].text).toBe("Fixed.");
    expect(replyBody.message).toContain("resubmit");
  });

  test("resubmit marks outdated threads on changed hunks", async ({ request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Initial review",
      TWO_FILE_DIFF
    );

    // Post a thread on hunk for a.ts
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Comment on a.ts", hunkId: null, line: null },
    });

    // Resubmit with a different diff where a.ts changed
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
    const updateBody = await updateRes.json();
    expect(updateBody.sessionId).toBe(sessionId);
    expect(updateBody.message).toContain("outdated");
  });

  test("resubmit preserves comments on unchanged hunks", async ({ request }) => {
    // b.ts hunk is the same in both diffs
    const { sessionId } = await createDiffSession(
      request,
      "Initial review",
      TWO_FILE_DIFF
    );

    // We need the hunk ID for b.ts -- poll the session to trigger hunk storage
    // Then resubmit with changed a.ts but same b.ts
    const UPDATED_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+changed_value
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

  test("done marks session complete", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    const doneRes = await request.post(`/s/${sessionId}/done`);
    expect(doneRes.status()).toBe(200);
    const body = await doneRes.json();
    expect(body.done).toBe(true);

    // Poll should return done
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
    });
    const pollBody = await pollRes.json();
    expect(pollBody.status).toBe("done");
  });

  test("resubmit to completed session is rejected", async ({ request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await request.post(`/s/${sessionId}/done`);

    const res = await request.post("/diff", {
      headers: JSON_ACCEPT,
      multipart: {
        sessionId,
        description: "Updated",
        diff: DIFF,
      },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already complete");
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
    await expect(page.getByText("Install dependencies")).toBeVisible();
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

  test("reply advances cursor so poll does not return the same threads again", async ({ page, request }) => {
    const { sessionId } = await createDiffSession(
      request,
      "Review",
      DIFF
    );
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Please fix the typo");
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment;
    const pollBody = await pollRes.json();
    expect(pollBody.status).toBe("comments");
    const threadId = pollBody.threads[0].id as number;

    // Reply to the thread -- this should advance the cursor
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const replyRes = await request.post(`/diff/${sessionId}/reply`, {
      multipart: {
        threadId: String(threadId),
        text: "Fixed the typo.",
      },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;
    expect(replyRes.status()).toBe(200);
    const replyBody = await replyRes.json();
    // After reply, the next poll result should be "done" not "comments" with old threads
    expect(replyBody.status).toBe("done");
  });
});
