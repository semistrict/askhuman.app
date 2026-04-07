import { test, expect } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const PLAN_MARKDOWN = `# Architecture Plan

## Overview
This is the plan overview.

## Step 1
Implement the data layer.

## Step 2
Build the API endpoints.

\`\`\`typescript
const x = 42;
\`\`\`
`;

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

test.describe("Plan Review", () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/plan", {
      data: PLAN_MARKDOWN,
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    sessionId = body.sessionId;
  });

  test("agent submits plan", async ({ request }) => {
    const res = await request.post("/plan", {
      data: "# My Plan\n\nDo things.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(
      /^[A-Za-z0-9_-]{22}$/
    );
    expect(body.url).toContain(`/s/${body.sessionId}`);
  });

  test("human views plan", async ({ page }) => {
    await page.goto(`/s/${sessionId}`);
    await expect(page.locator("text=Architecture Plan").first()).toBeVisible();
    await expect(page.locator("button >> text=1").first()).toBeVisible();
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

  test("agent receives comments after Done", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Plan\nLine 1",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();

    await request.post(`/s/${id}/threads`, {
      data: { text: "New feedback" },
    });
    await request.post(`/s/${id}/done`);

    const res = await request.get(`/plan/${id}/poll`, {
      headers: JSON_ACCEPT,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("New feedback");
  });

  test("poll returns error if the human has not connected", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Waiting\nNo browser yet.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id, url } = await planRes.json();

    const res = await request.get(`/plan/${id}/poll`, {
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
    const planRes = await request.post("/plan", {
      data: "# Waiting\nDisconnect test.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();

    await page.goto(`/s/${id}`);
    await expect(page.getByText("Plan Review")).toBeVisible();

    const pollPromise = fetch(`http://localhost:15032/plan/${id}/poll`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "curl/8.7.1",
      },
    });

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

  test("poll waits for Done, not individual comments", async ({ page, request }) => {
    const planRes = await request.post("/plan", {
      data: "# Wait Test\nContent.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();
    await page.goto(`/s/${id}`);

    // Post comment and then Done after a delay
    setTimeout(async () => {
      await request.post(`/s/${id}/threads`, { data: { text: "Feedback" } });
      await request.post(`/s/${id}/done`);
    }, 100);

    const res = await request.get(`/plan/${id}/poll`, {
      headers: JSON_ACCEPT,
      timeout: 10000,
    });
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Feedback");
  });

  test("comments posted before done are not lost", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Plan\nContent.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();

    // Human posts comment then immediately clicks Done
    await request.post(`/s/${id}/threads`, {
      data: { text: "Last-minute feedback" },
    });
    await request.post(`/s/${id}/done`);

    // Agent polls — should get both the comment AND done status
    const res = await request.get(`/plan/${id}/poll`, {
      headers: JSON_ACCEPT,
    });
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].messages[0].text).toBe("Last-minute feedback");
  });

  test("poll markdown includes context lines around line comments", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Plan\nLine one.\nLine two.\nLine three.\nLine four.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();

    await request.post(`/s/${id}/threads`, {
      data: { line: 3, text: "Fix this line" },
    });
    await request.post(`/s/${id}/done`);

    const res = await request.get(`/plan/${id}/poll`);
    const text = await res.text();
    // Should contain the comment number and location
    expect(text).toContain("#1 (L3)");
    // Should contain the target line with > marker
    expect(text).toContain("> ");
    expect(text).toContain("Line two.");
    // Should contain surrounding context
    expect(text).toContain("Line one.");
    expect(text).toContain("Line three.");
    // Should contain the comment text
    expect(text).toContain("Fix this line");
  });

  test("reopening done session shows content with buttons disabled", async ({ page, request }) => {
    const planRes = await request.post("/plan", {
      data: "# Done Plan\nReview this.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    const { sessionId: id } = await planRes.json();

    await request.post(`/s/${id}/threads`, { data: { text: "Looks great" } });
    await request.post(`/s/${id}/done`);

    await page.goto(`/s/${id}`);
    // Content is visible
    await expect(page.locator("text=Done Plan")).toBeVisible();
    // Comment is visible
    await expect(page.locator("text=#1")).toBeVisible();
    await expect(page.locator("text=Looks great")).toBeVisible();
    // Done notice shown, buttons gone
    await expect(page.locator("text=Waiting for agent")).toBeVisible();
    await expect(page.locator("button", { hasText: "Done" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Comment" })).not.toBeVisible();
  });

  test("plan endpoint returns markdown by default", async ({ request }) => {
    const res = await request.post("/plan", {
      data: "# Markdown Default\n\nBody.",
      headers: { "Content-Type": "text/markdown" },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/markdown");
    await expect(res.text()).resolves.toContain("# Plan Review Session");
  });

  test("404 for nonexistent session page", async ({ page }) => {
    await page.goto("/s/nonexistent-id");
    await expect(page.locator("text=No content found")).toBeVisible();
  });
});
