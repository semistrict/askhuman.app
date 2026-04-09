import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const PLAN_MARKDOWN = `# Architecture Doc

## Overview
This is the doc overview.

## Step 1
Implement the data layer.

## Step 2
Build the API endpoints.

\`\`\`typescript
const x = 42;
\`\`\`
`;

async function createDocSession(
  request: { post: Function },
  markdown: string = PLAN_MARKDOWN
) {
  const res = await request.post("/review", {
    headers: JSON_ACCEPT,
    multipart: {
      "doc.md": markdown,
    },
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

async function beginDocPoll(sessionId: string) {
  return fetch(`http://localhost:15032/review/${sessionId}/poll`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "curl/8.7.1",
    },
  });
}

test.describe("Markdown File Review", () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const body = await createDocSession(request);
    sessionId = body.sessionId;
  });

  test("agent submits doc", async ({ request }) => {
    const body = await createDocSession(request, "# My Doc\n\nDo things.");
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
  });

  test("human views doc", async ({ page }) => {
    await page.goto(`/s/${sessionId}`);
    await expect(page.locator("text=Architecture Doc").first()).toBeVisible();
    await expect(page.getByText("File Review")).toBeVisible();
    await expect(page.locator("button >> text=1").first()).toBeVisible();
  });

  test("settings persist in localStorage", async ({ page }) => {
    await page.goto(`/s/${sessionId}`);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

    const checkbox = page.getByLabel("Enable PostHog monitoring");
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Enable PostHog monitoring")).toBeChecked();
  });

  test("human posts general comment", async ({ request }) => {
    const res = await request.post(`/s/${sessionId}/threads`, {
      data: { text: "This looks good overall!" },
    });
    expect(res.status()).toBe(200);
    const thread = await res.json();
    expect(thread.line).toBeNull();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].role).toBe("human");
    expect(thread.messages[0].text).toBe("This looks good overall!");
  });

  test("human posts line comment", async ({ request }) => {
    const res = await request.post(`/s/${sessionId}/threads`, {
      data: { line: 3, text: "Can you clarify this?" },
    });
    expect(res.status()).toBe(200);
    const thread = await res.json();
    expect(thread.line).toBe(3);
    expect(thread.messages[0].text).toBe("Can you clarify this?");
  });

  test("agent receives comments after Request Revision", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Doc\nLine 1");
    await page.goto(`/s/${id}`);

    const pollPromise = beginDocPoll(id);
    await page.waitForTimeout(150);

    await request.post(`/s/${id}/threads`, {
      data: { text: "New feedback" },
    });
    await request.post(`/s/${id}/request-revision`);

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);
    const body = await pollRes.json() as {
      status: string;
      threads: Array<{ messages: Array<{ text: string }> }>;
    };
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("New feedback");
  });

  test("request revision copies feedback if agent is not polling", async ({ request }) => {
    const { sessionId: id } = await createDocSession(request, "# Waiting\nNo poll yet.");
    await request.post(`/s/${id}/threads`, {
      data: { text: "Please revise the summary." },
    });

    const res = await request.post(`/s/${id}/request-revision`, {
      headers: JSON_ACCEPT,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.state).toBe("agent_not_polling");
    expect(body.message).toContain("Agent is not polling");
    expect(body.clipboardText).toContain("Please revise the summary.");
    expect(body.clipboardText).toContain(`curl -s -X POST http://localhost:15032/review`);
    expect(body.clipboardText).toContain(`poll again with \`curl -s http://localhost:15032/review/${id}/poll\`.`);
  });

  test("poll returns error if the human has not connected", async ({ request }) => {
    const { sessionId: id, url } = await createDocSession(request, "# Waiting\nNo browser yet.");

    const res = await request.get(`/review/${id}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.url).toBe(url);
    expect(body.message).toContain("The same user you are already interacting with has not connected yet.");
    expect(body.message).toContain(url);
    expect(body.message).toContain(`open "${url}"`);
  });

  test("poll returns error after the human disconnects for 5 seconds", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Waiting\nDisconnect test.");

    await page.goto(`/s/${id}`);
    await expect(page.getByText("File Review")).toBeVisible();

    const pollPromise = beginDocPoll(id);

    await page.waitForTimeout(250);
    await page.close();

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);
    const body = await pollRes.json() as { status: string; message: string };
    expect(body.status).toBe("error");
    expect(body.message).toContain("No human reviewer tabs have been connected to this session for at least 5 seconds.");
    expect(body.message).toContain(`open "http://localhost:15032/s/${id}"`);
  });

  test("curling the session page returns a human-facing warning", async ({ request }) => {
    const res = await request.get(`/s/${sessionId}`, {
      headers: { "User-Agent": "curl/8.7.1" },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("This URL is meant for the human reviewer, not the agent.");
    expect(text).toContain(`open "http://localhost:15032/s/${sessionId}"`);
    expect(text).toContain(`xdg-open "http://localhost:15032/s/${sessionId}"`);
  });

  test("poll waits for Request Revision, not individual comments", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Wait Test\nContent.");
    await page.goto(`/s/${id}`);

    const pollPromise = beginDocPoll(id);
    await page.waitForTimeout(150);

    await request.post(`/s/${id}/threads`, { data: { text: "Feedback" } });
    await page.waitForTimeout(150);

    await request.post(`/s/${id}/request-revision`);

    const pollRes = await pollPromise;
    const body = await pollRes.json() as {
      status: string;
      threads: Array<{ messages: Array<{ text: string }> }>;
    };
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Feedback");
  });

  test("comments posted before Request Revision are not lost", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Doc\nContent.");
    await page.goto(`/s/${id}`);

    await request.post(`/s/${id}/threads`, {
      data: { text: "Last-minute feedback" },
    });

    const pollPromise = beginDocPoll(id);
    await page.waitForTimeout(150);
    await request.post(`/s/${id}/request-revision`);

    const pollRes = await pollPromise;
    const body = await pollRes.json();
    expect(body.status).toBe("done");
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].messages[0].text).toBe("Last-minute feedback");
  });

  test("poll markdown includes context lines around line comments", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(
      request,
      "# Doc\nLine one.\nLine two.\nLine three.\nLine four."
    );
    await page.goto(`/s/${id}`);

    await request.post(`/s/${id}/threads`, {
      data: { line: 3, text: "Fix this line" },
    });

    const pollPromise = fetch(`http://localhost:15032/review/${id}/poll`);
    await page.waitForTimeout(150);
    await request.post(`/s/${id}/request-revision`);

    const pollRes = await pollPromise;
    const text = await pollRes.text();
    expect(text).toContain("#1 (L3)");
    expect(text).toContain("> ");
    expect(text).toContain("Line two.");
    expect(text).toContain("Line one.");
    expect(text).toContain("Line three.");
    expect(text).toContain("Fix this line");
  });

  test("processing state is shown until the agent updates the doc", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Original Doc\n\nReview this.");
    await page.goto(`/s/${id}`);

    const pollPromise = beginDocPoll(id);
    await page.waitForTimeout(150);

    await request.post(`/s/${id}/threads`, { data: { text: "Rewrite the intro" } });
    await page.getByRole("button", { name: "Request Revision" }).click();

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);

    await expect(page.getByText("Agent processing feedback...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request Revision" })).not.toBeVisible();

    const updateRes = await request.post(`/review`, {
      multipart: {
        sessionId: id,
        "doc.md": "# Updated Doc\n\nFresh revision.",
        response: "Updated the introduction and tightened the structure.",
      },
    });
    expect(updateRes.status()).toBe(200);

    await expect(page.locator("text=Updated Doc")).toBeVisible();
    await expect(page.locator("text=Updated the introduction and tightened the structure.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request Revision" })).toBeVisible();
  });

  test("processing state can copy feedback for manual fallback", async ({ page, context, request }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { sessionId: id } = await createDocSession(request, "# Original Doc\n\nReview this.");
    await page.goto(`/s/${id}`);

    const pollPromise = beginDocPoll(id);
    await page.waitForTimeout(150);

    await request.post(`/s/${id}/threads`, { data: { text: "Rewrite the intro" } });
    await page.getByRole("button", { name: "Request Revision" }).click();

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);

    await page.getByRole("button", { name: "Copy Feedback Instead" }).click();
    await expect(page.getByText("Feedback copied to the clipboard.")).toBeVisible();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("Rewrite the intro");
    expect(clipboardText).toContain(`curl -s -X POST http://localhost:15032/review`);
    expect(clipboardText).toContain(`poll again with \`curl -s http://localhost:15032/review/${id}/poll\`.`);
  });

  test("updated doc only returns new human comments on the next request", async ({ page, request }) => {
    const { sessionId: id } = await createDocSession(request, "# Version 1");
    await page.goto(`/s/${id}`);

    await request.post(`/s/${id}/threads`, { data: { text: "Old comment" } });
    const firstPoll = beginDocPoll(id);
    await page.waitForTimeout(150);
    await request.post(`/s/${id}/request-revision`);
    const firstBody = await (await firstPoll).json() as {
      threads: Array<{ messages: Array<{ text: string }> }>;
    };
    expect(firstBody.threads).toHaveLength(1);
    expect(firstBody.threads[0].messages[0].text).toBe("Old comment");

    await request.post(`/review`, {
      multipart: { sessionId: id, "doc.md": "# Version 2" },
    });
    await expect(page.locator("text=Version 2")).toBeVisible();

    await request.post(`/s/${id}/threads`, { data: { text: "New comment" } });
    const secondPoll = beginDocPoll(id);
    await page.waitForTimeout(150);
    await request.post(`/s/${id}/request-revision`);
    const secondBody = await (await secondPoll).json() as {
      threads: Array<{ messages: Array<{ text: string }> }>;
    };
    expect(secondBody.threads).toHaveLength(1);
    expect(secondBody.threads[0].messages[0].text).toBe("New comment");
  });

  test("review endpoint returns markdown by default for raw markdown submission", async ({ request }) => {
    const res = await request.post("/review", {
      data: "# Markdown Default\n\nBody.",
      headers: { "Content-Type": "text/markdown" },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/markdown");
    await expect(res.text()).resolves.toContain("# File Review Session");
  });

  test("404 for nonexistent session page", async ({ page }) => {
    await page.goto("/s/nonexistent-id");
    await expect(page.locator("text=No content found")).toBeVisible();
  });
});
