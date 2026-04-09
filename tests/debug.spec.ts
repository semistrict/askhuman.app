import { expect, test } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

async function startReviewSession(request: { post: Function }) {
  const res = await request.post("/review", { headers: JSON_ACCEPT });
  expect(res.status()).toBe(200);
  return await res.json();
}

function submitReviewSession(sessionId: string, markdown: string) {
  const formData = new FormData();
  formData.set("doc.md", markdown);
  return fetch(`http://localhost:15032/review/${sessionId}`, {
    method: "POST",
    headers: JSON_ACCEPT,
    body: formData,
  });
}

test.describe("Debug Endpoints", () => {
  test("list connected tabs and execute JS inside a live reviewer tab", async ({
    page,
    request,
  }) => {
    const { sessionId } = await startReviewSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitReviewSession(sessionId, "# Debug target\n\nHello from the file page.\n");
    await expect(page.getByText("Debug target")).toBeVisible();

    let tabId: string | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const listRes = await request.get(`/s/${sessionId}/debug/tabs`, { headers: JSON_ACCEPT });
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const match = (body.tabs as Array<{ tabId: string; sessionId: string }>)[0];
      if (match) {
        tabId = match.tabId;
        break;
      }
      await page.waitForTimeout(100);
    }

    expect(tabId).toBeTruthy();

    const evalRes = await request.post(`/s/${sessionId}/debug/tabs/${tabId}/eval`, {
      data: `
return {
  title: document.title,
  heading: document.querySelector("h1")?.textContent ?? null,
  path: window.location.pathname,
  hasRequestRevisionButton: !!Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Request Revision"))
};
      `,
      headers: JSON_ACCEPT,
    });
    expect(evalRes.status()).toBe(200);
    const result = await evalRes.json();
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.result.heading).toBe("File Review");
    expect(result.result.path).toBe(`/s/${sessionId}`);
    expect(result.result.hasRequestRevisionButton).toBe(true);

    await request.post(`/s/${sessionId}/request-revision`);
    await actionPromise;
  });

  test("list connected agent long-polls while a review poll is in flight", async ({ page, request }) => {
    const { sessionId } = await startReviewSession(request);
    await page.goto(`/s/${sessionId}`);

    const actionPromise = submitReviewSession(sessionId, "# Debug target\n\nHello from the file page.\n");
    await expect(page.getByText("Debug target")).toBeVisible();

    let agentId: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const listRes = await request.get(`/s/${sessionId}/debug/agents`, { headers: JSON_ACCEPT });
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const match = (body.agents as Array<{
        agentId: string;
        sessionId: string;
        kind: string;
        endpoint: string;
      }>).find((agent) => agent.kind === "review_poll");
      if (match) {
        agentId = match.agentId;
        expect(match.endpoint).toBe(`/review/${sessionId}`);
        break;
      }
      await page.waitForTimeout(100);
    }

    expect(agentId).toBeTruthy();

    await request.post(`/s/${sessionId}/request-revision`);
    const actionRes = await actionPromise;
    expect(actionRes.status).toBe(200);

    for (let attempt = 0; attempt < 20; attempt++) {
      const listRes = await request.get(`/s/${sessionId}/debug/agents`, { headers: JSON_ACCEPT });
      const body = await listRes.json();
      const stillConnected = (body.agents as Array<{ agentId: string }>).some(
        (agent) => agent.agentId === agentId
      );
      if (!stillConnected) return;
      await page.waitForTimeout(100);
    }

    throw new Error(`Agent long-poll ${agentId} was still listed after the request completed`);
  });
});
