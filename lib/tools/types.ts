import type { ContentContext } from "@/lib/rest-response";

export type ToolId = "review" | "diff" | "present" | "playground" | "share";

export type SessionPhase = "awaiting_init" | "active";

export type BootstrapResult = {
  sessionId: string;
  url: string;
  tool: ToolId;
  message: string;
  next: string;
  openCommands: {
    chromeApp: string;
    fallback: string;
  };
};

export type ActionContext = {
  sessionId: string;
  baseUrl: string;
};

export type ActionResult = {
  sessionId: string;
  pollPrefix: string;
  message?: string;
};

export interface Tool<ActionInput = unknown, PollResult = unknown> {
  id: ToolId;
  aliases?: string[];
  bootstrap(args: ActionContext): Promise<BootstrapResult>;
  parseActionRequest(request: Request): Promise<ActionInput>;
  applyAction(args: ActionContext & { input: ActionInput }): Promise<ActionResult>;
  poll(args: ActionContext): Promise<PollResult>;
  buildPollContext?(sessionId: string): Promise<ContentContext | undefined>;
  renderPollMarkdown?(result: PollResult, context?: ContentContext): string;
}
