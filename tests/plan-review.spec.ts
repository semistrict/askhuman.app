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
    // Create a session for use across tests
    const res = await request.post("/agent/sessions");
    expect(res.status()).toBe(200);
    const body = await res.json();
    sessionId = body.id;

    // Post a plan
    const planRes = await request.post(
      `/agent/sessions/${sessionId}/plan`,
      {
        data: PLAN_MARKDOWN,
        headers: { "Content-Type": "text/markdown" },
      }
    );
    expect(planRes.status()).toBe(200);
  });

  test("agent creates session", async ({ request }) => {
    const res = await request.post("/agent/sessions");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("agent posts plan", async ({ request }) => {
    const id = (await (await request.post("/agent/sessions")).json()).id;
    const res = await request.post(`/agent/sessions/${id}/plan`, {
      data: "# My Plan\n\nDo things.",
      headers: { "Content-Type": "text/markdown" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.url).toContain(`/session/${id}`);
  });

  test("human views plan", async ({ page }) => {
    await page.goto(`/session/${sessionId}`);
    // The plan source lines should show the heading text
    await expect(page.locator("text=Architecture Plan").first()).toBeVisible();
    // Line numbers should be visible in the gutter
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
    // Create a fresh session to control timing
    const id = (await (await request.post("/agent/sessions")).json()).id;
    await request.post(`/agent/sessions/${id}/plan`, {
      data: "# Plan\nLine 1",
      headers: { "Content-Type": "text/markdown" },
    });

    // Post a comment
    await request.post(`/session/${id}/threads`, {
      data: { text: "New feedback" },
    });

    // Long-poll should return immediately with the new comment
    const res = await request.get(`/agent/sessions/${id}/comments`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.threads.length).toBeGreaterThan(0);
    expect(body.threads[0].messages[0].text).toBe("New feedback");
  });

  test("agent replies to thread", async ({ request }) => {
    // Create thread first
    const threadRes = await request.post(`/session/${sessionId}/threads`, {
      data: { text: "Question about step 1" },
    });
    const thread = await threadRes.json();

    const res = await request.post(
      `/agent/sessions/${sessionId}/threads/${thread.id}/messages`,
      { data: "Good point, I will update the plan." }
    );
    expect(res.status()).toBe(200);
    const msg = await res.json();
    expect(msg.role).toBe("agent");
    expect(msg.text).toBe("Good point, I will update the plan.");
    expect(msg.thread_id).toBe(thread.id);
  });

  test("WebSocket receives agent reply", async ({ page, request }) => {
    // Create a fresh session
    const id = (await (await request.post("/agent/sessions")).json()).id;
    await request.post(`/agent/sessions/${id}/plan`, {
      data: "# WS Test Plan\nLine one.",
      headers: { "Content-Type": "text/markdown" },
    });

    // Create a thread via API
    const threadRes = await request.post(`/session/${id}/threads`, {
      data: { text: "Initial comment" },
    });
    const thread = await threadRes.json();

    // Collect console messages and errors
    const consoleLogs: string[] = [];
    page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => consoleLogs.push(`[pageerror] ${err.message}`));

    // Navigate to the page (WS connects)
    await page.goto(`/session/${id}`);
    await expect(page.locator("text=Initial comment")).toBeVisible();

    // Expand the thread (click on it to show replies)
    await page.locator("text=Initial comment").click();

    // Post an agent reply via API
    const replyRes = await request.post(
      `/agent/sessions/${id}/threads/${thread.id}/messages`,
      { data: "Agent reply via WS" }
    );
    expect(replyRes.status()).toBe(200);

    // The reply should appear in the page via WebSocket
    await expect(page.locator("text=Agent reply via WS")).toBeVisible({
      timeout: 10000,
    });
  });

  test("long-poll returns empty after timeout", async ({ request }) => {
    // Create a fresh session with no activity
    const id = (await (await request.post("/agent/sessions")).json()).id;
    await request.post(`/agent/sessions/${id}/plan`, {
      data: "# Empty\nNothing here.",
      headers: { "Content-Type": "text/markdown" },
    });

    // Long-poll with a short timeout via X-Poll-Timeout header
    const res = await request.get(`/agent/sessions/${id}/comments`, {
      headers: { "X-Poll-Timeout": "2000" },
      timeout: 10000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.threads).toEqual([]);
  });

  test("404 for nonexistent session page", async ({ page }) => {
    const res = await page.goto("/session/nonexistent-id");
    // Page should render (the DO is created on access) but show "No plan found"
    await expect(page.locator("text=No plan found")).toBeVisible();
  });
});
