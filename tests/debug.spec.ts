import { expect, test } from "@playwright/test";

const JSON_ACCEPT = { Accept: "application/json" };

async function createPlanSession(request: { post: Function }) {
  const res = await request.post("/plan", {
    data: "# Debug target\n\nHello from the plan page.\n",
    headers: JSON_ACCEPT,
  });
  expect(res.status()).toBe(200);
  return await res.json();
}

test.describe("Debug Endpoints", () => {
  test("list connected tabs and execute JS inside a live reviewer tab", async ({
    page,
    request,
  }) => {
    const { sessionId } = await createPlanSession(request);
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("Plan Review")).toBeVisible();

    let tabId: string | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const listRes = await request.get("/debug/tabs", { headers: JSON_ACCEPT });
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const match = (body.tabs as Array<{ tabId: string; sessionId: string }>).find(
        (tab) => tab.sessionId === sessionId
      );
      if (match) {
        tabId = match.tabId;
        break;
      }
      await page.waitForTimeout(100);
    }

    expect(tabId).toBeTruthy();

    const evalRes = await request.post(`/debug/tabs/${tabId}/eval`, {
      data: `
return {
  title: document.title,
  heading: document.querySelector("h1")?.textContent ?? null,
  path: window.location.pathname,
  hasCommentButton: !!Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Comment"))
};
      `,
      headers: JSON_ACCEPT,
    });
    expect(evalRes.status()).toBe(200);
    const result = await evalRes.json();
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.result.heading).toBe("Plan Review");
    expect(result.result.path).toBe(`/s/${sessionId}`);
    expect(result.result.hasCommentButton).toBe(true);
  });

  test("list connected agent long-polls while a curl wait is in flight", async ({
    request,
  }) => {
    const { sessionId } = await createPlanSession(request);
    const pollPromise = fetch(`http://localhost:15032/plan/${sessionId}/poll`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "curl/8.7.1",
      },
    });

    let agentId: string | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const listRes = await request.get("/debug/agents", { headers: JSON_ACCEPT });
      expect(listRes.status()).toBe(200);
      const body = await listRes.json();
      const match = (
        body.agents as Array<{
          agentId: string;
          sessionId: string;
          kind: string;
          endpoint: string;
        }>
      ).find((agent) => agent.sessionId === sessionId && agent.kind === "plan_poll");
      if (match) {
        agentId = match.agentId;
        expect(match.endpoint).toBe(`/plan/${sessionId}/poll`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(agentId).toBeTruthy();

    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);

    for (let attempt = 0; attempt < 20; attempt++) {
      const listRes = await request.get("/debug/agents", { headers: JSON_ACCEPT });
      const body = await listRes.json();
      const stillConnected = (
        body.agents as Array<{ agentId: string }>
      ).some((agent) => agent.agentId === agentId);
      if (!stillConnected) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Agent long-poll ${agentId} was still listed after the request completed`);
  });
});
