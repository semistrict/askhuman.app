import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PlanSession } from "./plan-session";
import {
  createSession,
  submitPlan,
  pollComments,
  replyToComments,
  type Message,
} from "@/lib/plan-review";

export class McpSession extends DurableObject {
  private server: McpServer | null = null;
  private transport: WebStandardStreamableHTTPServerTransport | null = null;
  private sessionName: string | null = null;
  private baseUrl: string | null = null;

  static getInstance(id: string) {
    const doId = env.MCP_SESSION.idFromName(id);
    return env.MCP_SESSION.get(doId) as DurableObjectStub<McpSession>;
  }

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
  }

  private async ensureInitialized(request: Request) {
    if (this.transport) return;

    this.sessionName =
      request.headers.get("x-mcp-session-name") || this.ctx.id.toString();
    this.baseUrl = new URL("/", request.url).toString().replace(/\/$/, "");

    this.transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => this.sessionName!,
    });

    this.server = new McpServer(
      { name: "plan-review", version: "1.0.0" },
      {
        capabilities: { logging: {} },
        instructions: [
          "Plan review tool. Submit a markdown plan for human review, then poll for comments.",
          "Workflow: call submit_plan → open the URL for the reviewer → call get_comments (long-polls, blocks until comments arrive or timeout).",
          "When get_comments returns comments, call reply_to_comments to respond (it auto-polls for the next round).",
          "Loop until status is 'done'.",
        ].join(" "),
      }
    );

    this.registerTools();
    await this.server.connect(this.transport);
  }

  private registerTools() {
    const server = this.server!;
    const baseUrl = this.baseUrl!;

    server.registerTool(
      "submit_plan",
      {
        title: "Submit Plan for Review",
        description:
          "Create a new review session and submit a markdown plan for human review. Returns a browser URL to share with the reviewer and a session ID for subsequent calls. After submitting, open the URL for the reviewer and call get_comments to wait for their feedback.",
        inputSchema: z.object({
          markdown: z
            .string()
            .describe("The plan content in markdown format"),
        }),
      },
      async ({ markdown }) => {
        const sessionId = createSession();
        const result = await submitPlan(sessionId, markdown, baseUrl);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  sessionId: result.sessionId,
                  url: result.url,
                  message:
                    "Plan submitted. Open the URL for the reviewer, then call get_comments to wait for their feedback.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );

    server.registerTool(
      "get_comments",
      {
        title: "Get Comments",
        description:
          "Long-poll for new human comments on a plan session. Blocks until comments arrive, the reviewer clicks Done, or the timeout elapses. Returns status: 'comments' (new feedback to address), 'timeout' (no activity yet, call again), or 'done' (review finished).",
        inputSchema: z.object({
          sessionId: z.string().describe("The plan session ID"),
          timeoutSeconds: z
            .number()
            .optional()
            .describe(
              "How long to wait for comments in seconds (default 30)"
            ),
        }),
      },
      async ({ sessionId, timeoutSeconds }) => {
        const timeoutMs = (timeoutSeconds ?? 30) * 1000;
        const result = await pollComments(sessionId, timeoutMs, baseUrl);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ sessionId, ...result }, null, 2),
            },
          ],
        };
      }
    );

    server.registerTool(
      "reply_to_comments",
      {
        title: "Reply to Comments",
        description:
          "Reply to one or more comment threads and automatically poll for the next round of comments. Returns sent confirmations plus the next batch of comments (or timeout/done status). This combines replying and polling in one call.",
        inputSchema: z.object({
          sessionId: z.string().describe("The plan session ID"),
          replies: z
            .array(
              z.object({
                threadId: z.number().describe("The thread ID to reply to"),
                text: z.string().describe("The reply text"),
              })
            )
            .describe("Array of replies to post"),
          timeoutSeconds: z
            .number()
            .optional()
            .describe(
              "How long to wait for next comments in seconds (default 30)"
            ),
        }),
      },
      async ({ sessionId, replies, timeoutSeconds }) => {
        const timeoutMs = (timeoutSeconds ?? 30) * 1000;
        const result = await replyToComments(
          sessionId,
          replies,
          timeoutMs,
          baseUrl
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ sessionId, ...result }, null, 2),
            },
          ],
        };
      }
    );
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized(request);
    return this.transport!.handleRequest(request);
  }
}
