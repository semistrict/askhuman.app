import { expect, test } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

const DOC = `# Architecture Doc

## Overview
This is the doc overview.

## Step 1
Implement the data layer.

## Step 2
Build the API endpoints.
`;

async function startDocSession(request: { post: Function }) {
  const res = await request.post("/review", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitDocSession(sessionId: string, markdown: string, extra: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set("doc.md", markdown);
  for (const [key, value] of Object.entries(extra)) {
    formData.set(key, value);
  }
  return fetch(`http://localhost:15032/review/${sessionId}`, {
    method: "POST",
    headers: JSON_ACCEPT,
    body: formData,
  });
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
  test("starts a review session and returns the nested action endpoint", async ({ request }) => {
    const body = await startDocSession(request);
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toContain(`/s/${body.sessionId}`);
    expect(body.message).toContain("Chrome app mode");
    expect(body.next).toContain(`/review/${body.sessionId}`);
  });

  test("bootstrap returns markdown instructions by default for a plain POST", async ({ request }) => {
    const res = await request.post("/review");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/markdown");
    await expect(res.text()).resolves.toContain("# Review Session");
  });

  test("root review endpoint rejects direct markdown upload now that bootstrap is separate", async ({
    request,
  }) => {
    const res = await request.post("/review", {
      data: "# Wrong\n\nThis should go to /review/{id}.",
      headers: { "Content-Type": "text/markdown", ...JSON_ACCEPT },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("POST /review only creates an empty review session");
  });

  test("browser renders the markdown doc after the action initializes the session", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDocSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDocSession(sessionId, DOC);
    await expect(page.getByText("Architecture Doc")).toBeVisible();
    await expect(page.getByText("Step 1")).toBeVisible();

    await request.post(`/s/${sessionId}/request-revision`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    expect((await actionRes.json()).status).toBe("done");
  });

  test("request revision copies feedback if the agent is not polling", async ({ page, request }) => {
    const { sessionId } = await startDocSession(request);
    await page.goto(`/s/${sessionId}`);

    const seedRes = await request.post(`/plan/${sessionId}/update`, {
      headers: JSON_ACCEPT,
      multipart: { markdown: "# Waiting\nNo poll yet." },
    });
    expect(seedRes.status()).toBe(200);
    await expect(page.getByText("Waiting")).toBeVisible();

    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "Please revise the summary." },
    });

    const res = await request.post(`/s/${sessionId}/request-revision`, {
      headers: JSON_ACCEPT,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.state).toBe("agent_not_polling");
    expect(body.message).toContain("Agent is not polling");
    expect(body.clipboardText).toContain("Please revise the summary.");
    expect(body.clipboardText).toContain(`curl -s -X POST http://localhost:15032/review/${sessionId}`);
    expect(body.clipboardText).toContain(
      `poll again with \`curl -s http://localhost:15032/review/${sessionId}/poll\`.`
    );
  });

  test("combined review action returns comments only after Request Revision", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDocSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDocSession(sessionId, "# Doc\nLine 1");
    await expect(page.getByText("Line 1")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, {
      data: { text: "New feedback" },
    });
    await request.post(`/s/${sessionId}/request-revision`);

    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);
    const body = await actionRes.json();
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("New feedback");
  });

  test("standalone poll still waits for Request Revision", async ({ page, request }) => {
    const { sessionId } = await startDocSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitDocSession(sessionId, "# Wait Test\nContent.");
    await expect(page.getByText("Wait Test")).toBeVisible();

    const pollPromise = beginDocPoll(sessionId);
    await request.post(`/s/${sessionId}/threads`, { data: { text: "Feedback" } });
    await page.waitForTimeout(150);
    await request.post(`/s/${sessionId}/request-revision`);

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);
    const body = (await pollRes.json()) as {
      status: string;
      threads: Array<{ messages: Array<{ text: string }> }>;
    };
    expect(body.status).toBe("done");
    expect(body.threads[0].messages[0].text).toBe("Feedback");
    await actionPromise;
  });

  test("processing state is shown until the agent updates the doc in the same session", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startDocSession(request);
    await page.goto(`/s/${sessionId}`);

    const initialAction = submitDocSession(sessionId, "# Original Doc\n\nReview this.");
    await expect(page.getByText("Original Doc")).toBeVisible();
    await request.post(`/s/${sessionId}/threads`, { data: { text: "Rewrite the intro" } });
    await page.getByRole("button", { name: "Request Revision" }).click();

    const initialRes = await initialAction;
    expect(initialRes.status).toBe(200);
    await expect(page.getByText("Agent processing feedback...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request Revision" })).not.toBeVisible();

    const updatePromise = submitDocSession(sessionId, "# Updated Doc\n\nFresh revision.", {
      response: "Updated the introduction and tightened the structure.",
    });
    await expect(page.getByText("Updated Doc")).toBeVisible();
    await expect(page.getByText("Updated the introduction and tightened the structure.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request Revision" })).toBeVisible();

    await request.post(`/s/${sessionId}/request-revision`);
    const updateRes = await updatePromise;
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).status).toBe("done");
  });

  test("action returns an error after waiting if the user never opens the page", async ({
    request,
  }) => {
    const { sessionId, url } = await startDocSession(request);
    const res = await request.post(`/review/${sessionId}`, {
      headers: JSON_ACCEPT,
      multipart: { "doc.md": "# Waiting\nNo browser yet." },
      timeout: 15000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.url).toBe(url);
    expect(body.message).toContain("has not connected yet");
  });
});
