import { test, expect } from "@playwright/test";

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

test.describe("Plan Review", () => {
  let sessionId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/plan", {
      data: PLAN_MARKDOWN,
      headers: { "Content-Type": "text/markdown" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    sessionId = body.sessionId;
  });

  test("agent submits plan", async ({ request }) => {
    const res = await request.post("/plan", {
      data: "# My Plan\n\nDo things.",
      headers: { "Content-Type": "text/markdown" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(body.url).toContain(`/session/${body.sessionId}`);
  });

  test("human views plan", async ({ page }) => {
    await page.goto(`/session/${sessionId}`);
    await expect(page.locator("text=Architecture Plan").first()).toBeVisible();
    await expect(page.locator("button >> text=1").first()).toBeVisible();
  });

  test("human posts general comment", async ({ request }) => {
    const res = await request.post(`/session/${sessionId}/threads`, {
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
    const res = await request.post(`/session/${sessionId}/threads`, {
      data: { line: 3, text: "Can you clarify this?" },
    });
    expect(res.status()).toBe(200);
    const thread = await res.json();
    expect(thread.line).toBe(3);
    expect(thread.messages[0].text).toBe("Can you clarify this?");
  });

  test("agent receives comments via long-poll", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Plan\nLine 1",
      headers: { "Content-Type": "text/markdown" },
    });
    const { sessionId: id } = await planRes.json();

    await request.post(`/session/${id}/threads`, {
      data: { text: "New feedback" },
    });

    const res = await request.get(`/plan/${id}/poll`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("comments");
    expect(body.threads[0].messages[0].text).toBe("New feedback");
  });

  test("agent replies to thread", async ({ request }) => {
    const threadRes = await request.post(`/session/${sessionId}/threads`, {
      data: { text: "Question about step 1" },
    });
    const thread = await threadRes.json();

    const res = await request.post(`/plan/${sessionId}/reply`, {
      data: {
        replies: [
          { threadId: thread.id, text: "Good point, I will update the plan." },
        ],
      },
      headers: { "X-Poll-Timeout": "1000" },
      timeout: 10000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sent[0].role).toBe("agent");
    expect(body.sent[0].text).toBe("Good point, I will update the plan.");
    expect(body.sent[0].thread_id).toBe(thread.id);
  });

  test("WebSocket receives agent reply", async ({ page, request }) => {
    const planRes = await request.post("/plan", {
      data: "# WS Test Plan\nLine one.",
      headers: { "Content-Type": "text/markdown" },
    });
    const { sessionId: id } = await planRes.json();

    const threadRes = await request.post(`/session/${id}/threads`, {
      data: { text: "Initial comment" },
    });
    const thread = await threadRes.json();

    await page.goto(`/session/${id}`);
    await expect(page.locator("text=Initial comment")).toBeVisible();
    await page.locator("text=Initial comment").click();

    await request.post(`/plan/${id}/reply`, {
      data: {
        replies: [{ threadId: thread.id, text: "Agent reply via WS" }],
      },
      headers: { "X-Poll-Timeout": "1000" },
      timeout: 10000,
    });

    await expect(page.locator("text=Agent reply via WS")).toBeVisible({
      timeout: 10000,
    });
  });

  test("long-poll returns empty after timeout", async ({ request }) => {
    const planRes = await request.post("/plan", {
      data: "# Empty\nNothing here.",
      headers: { "Content-Type": "text/markdown" },
    });
    const { sessionId: id } = await planRes.json();

    const res = await request.get(`/plan/${id}/poll`, {
      headers: { "X-Poll-Timeout": "2000" },
      timeout: 10000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("timeout");
    expect(body.threads).toEqual([]);
  });

  test("404 for nonexistent session page", async ({ page }) => {
    await page.goto("/session/nonexistent-id");
    await expect(page.locator("text=No plan found")).toBeVisible();
  });
});
