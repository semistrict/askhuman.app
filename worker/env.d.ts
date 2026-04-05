import type { PlanSession } from "./plan-session";
import type { McpSession } from "./mcp-session";

declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    IMAGES: {
      input(stream: ReadableStream): {
        transform(options: Record<string, unknown>): {
          output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
        };
      };
    };
    PLAN_SESSION: DurableObjectNamespace<PlanSession>;
    MCP_SESSION: DurableObjectNamespace<McpSession>;
  }
}
