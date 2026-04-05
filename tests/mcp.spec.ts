import { test, expect } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const BASE_URL = "http://localhost:3001";

function createMcpClient() {
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`${BASE_URL}/mcp`)
  );
  return { client, transport };
}

function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse(
    (result.content as { type: string; text: string }[])[0].text
  );
}

test.describe("MCP Plan Review", () => {
  test("initialize and list tools", async () => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "get_comments",
        "reply_to_comments",
        "submit_plan",
      ]);

      const submitPlan = tools.find((t) => t.name === "submit_plan")!;
      expect(submitPlan.description).toContain("review");
      expect(submitPlan.inputSchema.properties).toHaveProperty("markdown");

      const getComments = tools.find((t) => t.name === "get_comments")!;
      expect(getComments.inputSchema.properties).toHaveProperty(
        "timeoutSeconds"
      );
    } finally {
      await client.close();
    }
  });

  test("submit_plan creates session and plan is visible in browser", async ({
    page,
  }) => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "submit_plan",
        arguments: {
          markdown:
            "# MCP Test Plan\n\n## Goal\nVerify MCP submit works.\n\n## Steps\n1. Do the thing",
        },
      });

      expect(result.isError).toBeFalsy();
      const data = parseToolResult(result);
      expect(data.sessionId).toBeTruthy();
      expect(data.url).toContain("/session/");

      // Verify plan is visible in browser
      await page.goto(data.url);
      await expect(page.locator("text=MCP Test Plan").first()).toBeVisible();
      await expect(page.locator("text=Do the thing").first()).toBeVisible();
    } finally {
      await client.close();
    }
  });

  test("get_comments long-polls and returns comments", async ({ request }) => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);

      // Submit plan
      const submitData = parseToolResult(
        await client.callTool({
          name: "submit_plan",
          arguments: { markdown: "# Comments Test\n\nSome content." },
        })
      );
      const sessionId = submitData.sessionId;

      // Post a comment as human
      const threadRes = await request.post(`/session/${sessionId}/threads`, {
        data: { text: "Feedback from human", line: 1 },
      });
      expect(threadRes.status()).toBe(200);

      // get_comments should return the comment immediately
      const commentsData = parseToolResult(
        await client.callTool({
          name: "get_comments",
          arguments: { sessionId, timeoutSeconds: 5 },
        })
      );
      expect(commentsData.status).toBe("comments");
      expect(commentsData.threads).toHaveLength(1);
      expect(commentsData.threads[0].messages[0].text).toBe(
        "Feedback from human"
      );
      expect(commentsData.threads[0].line).toBe(1);
    } finally {
      await client.close();
    }
  });

  test("get_comments returns timeout when no activity", async () => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);

      const submitData = parseToolResult(
        await client.callTool({
          name: "submit_plan",
          arguments: { markdown: "# Timeout Test\n\nNothing here." },
        })
      );

      const commentsData = parseToolResult(
        await client.callTool({
          name: "get_comments",
          arguments: { sessionId: submitData.sessionId, timeoutSeconds: 2 },
        })
      );
      expect(commentsData.status).toBe("timeout");
      expect(commentsData.threads).toEqual([]);
    } finally {
      await client.close();
    }
  });

  test("get_comments returns done when review is finished", async ({
    request,
  }) => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);

      const submitData = parseToolResult(
        await client.callTool({
          name: "submit_plan",
          arguments: { markdown: "# Done Test\n\nQuick review." },
        })
      );
      const sessionId = submitData.sessionId;

      // Human marks session as done
      const doneRes = await request.post(`/session/${sessionId}/done`);
      expect(doneRes.status()).toBe(200);

      const commentsData = parseToolResult(
        await client.callTool({
          name: "get_comments",
          arguments: { sessionId, timeoutSeconds: 2 },
        })
      );
      expect(commentsData.status).toBe("done");
    } finally {
      await client.close();
    }
  });

  test("reply_to_comments posts reply visible in browser and auto-polls", async ({
    page,
    request,
  }) => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);

      // Submit plan
      const submitData = parseToolResult(
        await client.callTool({
          name: "submit_plan",
          arguments: { markdown: "# Reply Test\n\nContent here." },
        })
      );
      const sessionId = submitData.sessionId;

      // Post comment as human
      const threadRes = await request.post(`/session/${sessionId}/threads`, {
        data: { text: "Please clarify step 1" },
      });
      const thread = await threadRes.json();

      // Consume the comment via get_comments (advances cursor)
      await client.callTool({
        name: "get_comments",
        arguments: { sessionId, timeoutSeconds: 2 },
      });

      // Reply via MCP — auto-polls for next comments (will timeout since no new ones)
      const replyData = parseToolResult(
        await client.callTool({
          name: "reply_to_comments",
          arguments: {
            sessionId,
            replies: [
              { threadId: thread.id, text: "Step 1 means setting up the DB." },
            ],
            timeoutSeconds: 2,
          },
        })
      );
      expect(replyData.sent).toHaveLength(1);
      expect(replyData.sent[0].role).toBe("agent");
      expect(replyData.sent[0].text).toBe("Step 1 means setting up the DB.");
      expect(replyData.status).toBe("timeout"); // no new human comments

      // Verify reply is visible in browser
      await page.goto(submitData.url);
      await expect(
        page.locator("text=Please clarify step 1")
      ).toBeVisible();
      await page.locator("text=Please clarify step 1").click();
      await expect(
        page.locator("text=Step 1 means setting up the DB.")
      ).toBeVisible();
    } finally {
      await client.close();
    }
  });

  test("MCP and REST API interop on same session", async ({ request }) => {
    const { client, transport } = createMcpClient();
    try {
      await client.connect(transport);

      // Submit plan via MCP
      const submitData = parseToolResult(
        await client.callTool({
          name: "submit_plan",
          arguments: { markdown: "# Interop Test\n\nCross-API." },
        })
      );
      const sessionId = submitData.sessionId;

      // Post comment as human
      await request.post(`/session/${sessionId}/threads`, {
        data: { text: "Comment for interop test" },
      });

      // Poll via REST API — should see the comment
      const pollRes = await request.get(
        `/agent/sessions/${sessionId}/comments`,
        { headers: { "X-Poll-Timeout": "2000" }, timeout: 10000 }
      );
      expect(pollRes.status()).toBe(200);
      const pollBody = await pollRes.json();
      expect(pollBody.status).toBe("comments");
      expect(pollBody.threads[0].messages[0].text).toBe(
        "Comment for interop test"
      );

      // Reply via REST API
      await request.post(`/agent/sessions/${sessionId}/reply`, {
        data: {
          replies: [
            { threadId: pollBody.threads[0].id, text: "REST reply" },
          ],
        },
        headers: { "X-Poll-Timeout": "1000" },
        timeout: 10000,
      });

      // Post another comment so MCP get_comments has something to return
      await request.post(`/session/${sessionId}/threads`, {
        data: { text: "Second comment" },
      });

      // MCP get_comments should see the new comment
      const commentsData = parseToolResult(
        await client.callTool({
          name: "get_comments",
          arguments: { sessionId, timeoutSeconds: 5 },
        })
      );
      expect(commentsData.status).toBe("comments");
      expect(
        commentsData.threads.some((t: { messages: { text: string }[] }) =>
          t.messages.some((m: { text: string }) => m.text === "Second comment")
        )
      ).toBe(true);
    } finally {
      await client.close();
    }
  });
});
