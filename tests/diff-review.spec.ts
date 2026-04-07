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

const TWO_HUNK_DIFF = `diff --git a/a.ts b/a.ts
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

const CONTEXT_HEADER_DIFF = `diff --git a/docs.md b/docs.md
--- a/docs.md
+++ b/docs.md
@@ -1,2 +1,2 @@ usage example
-before
+after
 keep
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

async function startDiffSession(request: { post: Function }) {
  const res = await request.post("/diff", {
    data: "",
    headers: JSON_ACCEPT,
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

function requestBody(description: string, diff: string) {
  return {
    headers: JSON_ACCEPT,
    multipart: {
      description,
      diff,
    },
    timeout: 10000,
  };
}

function requestBodyWithOptions(
  description: string,
  diff: string,
  extraMultipart: Record<string, string>
) {
  return {
    headers: JSON_ACCEPT,
    multipart: {
      description,
      diff,
      ...extraMultipart,
    },
    timeout: 10000,
  };
}

function makeMultiHunkDiff(
  filePrefix: string,
  count: number,
  valuePrefix: string
): string {
  return Array.from({ length: count }, (_, i) => {
    const file = `${filePrefix}${i + 1}.ts`;
    return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1 +1 @@
-const value = "${valuePrefix}-old-${i + 1}";
+const value = "${valuePrefix}-new-${i + 1}";
`;
  }).join("");
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
  test("diff endpoint creates an empty review session", async ({ request }) => {
    const body = await startDiffSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain(`/diff/${body.sessionId}/request`);
    expect(body.message).toContain(`/diff/${body.sessionId}/complete`);
    expect(body.message).toContain("updates the visible review and waits for");
  });

  test("diff endpoint rejects a non-empty body", async ({ request }) => {
    const res = await request.post("/diff", {
      data: DIFF,
      headers: JSON_ACCEPT,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("POST /diff with an empty body");
  });

  test("browser shows waiting state before first request", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(page.request);
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Waiting for agent")).toBeVisible();
  });

  test("request renders interleaved markdown and expanded hunks", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Looks good");
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Refactored constants

Updated y and added z.

\`\`\`patch
@@ -1,3 +1,4 @@
 const x = 1;
...
+const z = 4;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("Looks good");

    await expect(page.locator("main .prose h1")).toHaveText("Refactored constants");
    await expect(page.locator("text=Updated y and added z.")).toBeVisible();
    await expect(page.locator("text=foo.ts")).toBeVisible();
    await expect(page.locator("text=const z = 4;")).toBeVisible();
  });

  test("request accepts patch info string with file path and hunk header", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Refactored constants

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
...
+const z = 4;
\`\`\`
`,
        DIFF
      )
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("The visible diff request has already been updated.");
    expect(body.message).toContain("continue waiting with /poll");
    expect(body.next).toContain(`/diff/${sessionId}/poll`);
  });

  test("request accepts normalized hunk header without trailing context text", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Docs change

\`\`\`patch docs.md @@ -1,2 +1,2 @@
-before
+after
\`\`\`
`,
        CONTEXT_HEADER_DIFF
      )
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toContain("The visible diff request has already been updated.");
    expect(body.message).toContain("continue waiting with /poll");
    expect(body.next).toContain(`/diff/${sessionId}/poll`);
  });

  test("all-additions markdown hunks render like plan review", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const diff = makeMarkdownAddedDiff();
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Docs only

\`\`\`patch
README.md
@@ -0,0 +1,4 @@
+# Getting Started
\`\`\`
`,
        diff
      )
    );
    await delayedDone;

    expect(res.status()).toBe(200);
    await expect(page.locator('[data-hunk-rendering="markdown-additions"]')).toBeVisible();
    await expect(page.getByText("Getting Started")).toBeVisible();
    await expect(page.getByText("Install dependencies")).toBeVisible();
  });

  test("all-additions code hunks render as highlighted source", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const diff = makeAddedHunkDiff("new-file.ts", 3);
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Code only

\`\`\`patch
new-file.ts
@@ -0,0 +1,3 @@
+const line1 = 1;
\`\`\`
`,
        diff
      )
    );
    await delayedDone;

    expect(res.status()).toBe(200);
    await expect(page.locator('[data-hunk-rendering="source-additions"]')).toBeVisible();
    await expect(page.getByText("const line1 = 1;")).toBeVisible();
  });

  test("same request body can be reposted to continue waiting", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    const description = `# Retry same request

\`\`\`patch
foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`;

    const first = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(description, DIFF)
    );
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.status).toBe("error");
    expect(firstBody.message).toContain("has not connected yet");
    expect(firstBody.next).toContain(`/diff/${sessionId}/poll`);

    await page.goto(`/s/${sessionId}`);
    const delayedComment = postThreadAfterDelay(request, sessionId, "Second attempt feedback");
    const second = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(description, DIFF)
    );
    await delayedComment;

    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.status).toBe("comments");
    expect(secondBody.threads[0].messages[0].text).toBe("Second attempt feedback");
  });

  test("different active request with unread comments is rejected", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    // Establish first request — comment arrives and is consumed
    const delayedComment = postThreadAfterDelay(request, sessionId, "First feedback");
    const first = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `First request

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe("comments");

    // Post a NEW comment after the first request returned — this one is unread
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Needs more work" },
    });

    const second = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Second request

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
+const z = 4;
\`\`\`
`,
        DIFF
      )
    );
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.error).toContain("unread human comments");
    expect(body.error).toContain("Reply to the comments first");
  });

  test("dismiss fails when there are unread human comments", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);

    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Active request

\`\`\`patch
foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("error");

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Unread feedback" },
    });

    const dismiss = await request.post(`/diff/${sessionId}/dismiss`, {
      headers: JSON_ACCEPT,
    });
    expect(dismiss.status()).toBe(409);
    const body = await dismiss.json();
    expect(body.error).toContain("unread human comments");
  });

  test("reply response reminds the agent to refresh the visible review after code changes", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Initial feedback");
    const requestRes = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Review

\`\`\`patch
foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;
    const requestBodyJson = await requestRes.json();
    const threadId = requestBodyJson.threads[0].id as number;

    const delayedFollowUp = postThreadAfterDelay(request, sessionId, "Follow-up");
    const replyRes = await request.post(`/diff/${sessionId}/reply`, {
      multipart: {
        threadId: String(threadId),
        text: "Applied.",
      },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedFollowUp;

    expect(replyRes.status()).toBe(200);
    const body = await replyRes.json();
    expect(body.sent[0].text).toBe("Applied.");
    expect(body.message).toContain("update the human-visible review");
    expect(body.message).toContain("fresh /request");
  });

  test("complete requires every hunk in the latest diff to have been reviewed", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const firstDone = postDoneAfterDelay(request, sessionId);
    const firstRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `First hunk

\`\`\`patch
a.ts
@@ -1 +1 @@
-old
\`\`\`
`,
        TWO_HUNK_DIFF
      )
    );
    await firstDone;
    expect(firstRequest.status()).toBe(200);
    expect((await firstRequest.json()).status).toBe("next");

    const earlyComplete = await request.post(`/diff/${sessionId}/complete`, {
      data: TWO_HUNK_DIFF,
      headers: JSON_ACCEPT,
    });
    expect(earlyComplete.status()).toBe(409);
    expect((await earlyComplete.json()).error).toContain("have not been reviewed");

    const secondDone = postDoneAfterDelay(request, sessionId);
    const secondRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Second hunk

\`\`\`patch
b.ts
@@ -1 +1 @@
-x
\`\`\`
`,
        TWO_HUNK_DIFF
      )
    );
    await secondDone;
    expect(secondRequest.status()).toBe(200);
    const secondBody = await secondRequest.json();
    expect(secondBody.status).toBe("next");
    expect(secondBody.message).toContain(`/diff/${sessionId}/complete`);

    const complete = await request.post(`/diff/${sessionId}/complete`, {
      data: TWO_HUNK_DIFF,
      headers: JSON_ACCEPT,
    });
    expect(complete.status()).toBe(200);
    expect((await complete.json()).message).toContain("session is now complete");
  });

  test("poll endpoint waits for comments after a request is active", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Polled feedback");
    const requestRes = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Review

\`\`\`patch
foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;
    expect(requestRes.status()).toBe(200);

    const delayedComment2 = postThreadAfterDelay(request, sessionId, "More polled feedback");
    const pollRes = await request.get(`/diff/${sessionId}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedComment2;
    expect(pollRes.status()).toBe(200);
    const body = await pollRes.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("More polled feedback");
  });

  test("request no-match error suggests exact candidate fences", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Review

\`\`\`patch
diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
\`\`\`
`,
        DIFF
      )
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("did not match any hunk");
    expect(body.error).toContain("Do not include diff --git");
    expect(body.error).toContain("Closest matching hunks you could submit");
    expect(body.error).toContain("```patch foo.ts @@ -1,3 +1,4 @@");
  });

  test("request suggestions use normalized headers without trailing context text", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const res = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Review

\`\`\`patch docs.md @@ -1,2 +1,2 @@
missing
\`\`\`
`,
        CONTEXT_HEADER_DIFF
      )
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("```patch docs.md @@ -1,2 +1,2 @@");
    expect(body.error).not.toContain("@@ -1,2 +1,2 @@ usage example");
  });

  test("request rejects large diff churn unless allow_many_changes=true is set", async ({ request }) => {
    const { sessionId } = await startDiffSession(request);
    const initialDiff = makeMultiHunkDiff("old-", 8, "alpha");
    const changedDiff = makeMultiHunkDiff("new-", 8, "beta");
    const description = `# Large update

\`\`\`patch
new-1.ts
@@ -1 +1 @@
-const value = "beta-old-1";
+const value = "beta-new-1";
\`\`\`
`;

    const first = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Initial snapshot

\`\`\`patch
old-1.ts
@@ -1 +1 @@
-const value = "alpha-old-1";
+const value = "alpha-new-1";
\`\`\`
`,
        initialDiff
      )
    );
    expect(first.status()).toBe(200);

    const dismiss = await request.post(`/diff/${sessionId}/dismiss`, {
      headers: JSON_ACCEPT,
    });
    expect(dismiss.status()).toBe(200);

    const rejected = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(description, changedDiff)
    );
    expect(rejected.status()).toBe(409);
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error).toContain("more than 50%");
    expect(rejectedBody.error).toContain("allow_many_changes=true");

    const allowed = await request.post(
      `/diff/${sessionId}/request`,
      requestBodyWithOptions(description, changedDiff, {
        allow_many_changes: "true",
      })
    );
    expect(allowed.status()).toBe(200);
  });

  test("reply advances cursor so poll does not return the same threads again", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    const delayedComment = postThreadAfterDelay(request, sessionId, "Please fix the typo");
    const requestRes = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Review

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;
    expect(requestRes.status()).toBe(200);
    const body = await requestRes.json();
    expect(body.status).toBe("comments");
    const threadId = body.threads[0].id as number;

    // Reply to the thread — this should advance the cursor
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
    // After reply, the next poll result should NOT return the same "Please fix the typo" thread
    // It should be "next" (request completed by human clicking Done) not "comments"
    expect(replyBody.status).toBe("next");
  });

  test("reply unblocks request replacement without needing dismiss", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    // First request
    const delayedComment = postThreadAfterDelay(request, sessionId, "Change the variable name");
    const firstRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Review

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedComment;
    expect(firstRequest.status()).toBe(200);
    const firstBody = await firstRequest.json();
    expect(firstBody.status).toBe("comments");
    const threadId = firstBody.threads[0].id as number;

    // Reply to address the comment — also schedule a Done click to unblock the long-poll
    const delayedDone = postDoneAfterDelay(request, sessionId);
    await request.post(`/diff/${sessionId}/reply`, {
      multipart: {
        threadId: String(threadId),
        text: "Done, renamed.",
      },
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    await delayedDone;

    // Now send a different /request (simulating updated diff after code changes)
    // This should succeed because all comments were addressed
    const UPDATED_DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 const renamed = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { renamed };
`;

    // Schedule Done to unblock the second request's wait loop
    const delayedDone2 = postDoneAfterDelay(request, sessionId);
    const secondRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Updated review

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const renamed = 1;
\`\`\`
`,
        UPDATED_DIFF
      )
    );
    await delayedDone2;
    expect(secondRequest.status()).toBe(200);
    const secondBody = await secondRequest.json();
    // Should not be a 409 — the replacement was allowed
    expect(secondBody.sessionId).toBe(sessionId);
  });

  test("request replacement is blocked when comments are unread", async ({ page, request }) => {
    const { sessionId } = await startDiffSession(request);
    await page.goto(`/s/${sessionId}`);

    // First: get the request established and returned via human Done
    const delayedDone = postDoneAfterDelay(request, sessionId);
    const firstRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Review

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    await delayedDone;
    expect(firstRequest.status()).toBe(200);

    // Now post a comment AFTER the request was consumed — this is unread
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Needs work" },
    });

    // Send a second request which should pick up the unread comment via consumeAgentUpdate
    // and return it as "comments" status, not reject it
    const secondRequest = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `Updated review

\`\`\`patch foo.ts @@ -1,3 +1,4 @@
 const x = 1;
\`\`\`
`,
        DIFF
      )
    );
    expect(secondRequest.status()).toBe(200);
    const body = await secondRequest.json();
    // The second request was allowed (no active request blocking it after Done),
    // but it immediately returns the unread comment
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("Needs work");
  });

  test("Next copies the agent continuation when no agent is connected", async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const { sessionId } = await startDiffSession(request);
    const requestRes = await request.post(
      `/diff/${sessionId}/request`,
      requestBody(
        `# Refactored constants

\`\`\`patch a.ts @@ -1 +1 @@
-old
...
+new
\`\`\`
`,
        TWO_HUNK_DIFF
      )
    );
    expect(requestRes.status()).toBe(200);
    const requestBodyJson = await requestRes.json();
    expect(requestBodyJson.status).toBe("error");

    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Diff Review")).toBeVisible();

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Please carry this feedback into the next hunk." },
    });
    await page.locator("aside").getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByText("Response copied. Paste into agent to continue.")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("# Diff Request");
    expect(copied).toContain("Please carry this feedback into the next hunk.");
    expect(copied).toContain("After replying, immediately prepare the next /request using the latest full diff for this same session.");
  });
});
