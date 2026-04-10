import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { createCompactId } from "@/lib/compact-id";
import type { SessionPhase, ToolId } from "@/lib/tools/types";

const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_INACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

export interface Thread {
  id: number;
  hunk_id: string | null;
  line: number | null;
  file_path: string | null;
  location_label: string | null;
  selection_text: string | null;
  selection_context: string | null;
  outdated: boolean;
  created_at: number;
  messages: Message[];
}

export interface Message {
  id: number;
  thread_id: number;
  role: string;
  text: string;
  created_at: number;
}

function formatPreview(hunk: {
  oldStart: number;
  newStart: number;
  content: string;
}): string {
  const lines = hunk.content.split("\n").filter((line) => line !== "\\ No newline at end of file");
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  const previewLines: { lineNumber: number; text: string }[] = [];

  for (const line of lines) {
    if (line.startsWith("-")) {
      previewLines.push({ lineNumber: oldLine, text: line.slice(1) });
      oldLine += 1;
      continue;
    }
    if (line.startsWith("+")) {
      previewLines.push({ lineNumber: newLine, text: line.slice(1) });
      newLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      previewLines.push({ lineNumber: newLine, text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  const compact = (value: string) =>
    value.length > 20 ? `${value.slice(0, 20)}...` : value;
  const selected =
    previewLines.length <= 4
      ? previewLines
      : [previewLines[0], previewLines[1], null, previewLines[previewLines.length - 2], previewLines[previewLines.length - 1]];
  const numbered = selected.filter((line): line is { lineNumber: number; text: string } => line !== null);
  const width = Math.max(...numbered.map((line) => String(line.lineNumber).length), 1);
  const formatLine = ({ lineNumber, text }: { lineNumber: number; text: string }) =>
    `${String(lineNumber).padStart(width)}    ${compact(text)}`;
  return selected
    .map((line) => (line === null ? "..." : formatLine(line)))
    .join("\n");
}

type StoredHunkInput = {
  filePath: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  content: string;
};

function createPublicHunkId(hunk: StoredHunkInput): string {
  const payload = [hunk.filePath, hunk.content].join("\n");
  return createHash("md5").update(payload).digest("base64url");
}

function escapeSqlLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

type Waiter = {
  resolve: (value: { threads: Thread[]; done?: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActivityWaiter = {
  resolve: (value: { done: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ConnectionWaiter = {
  resolve: (value: { connected: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PresenceWaiter = {
  resolve: (value: { connected: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DebugEvalWaiter = {
  tabId: string;
  resolve: (value: { ok: boolean; result?: unknown; error?: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type TabAttachment = {
  kind: "tab";
  tabId: string;
};

type KvStreamAttachment = {
  kind: "kv_stream";
  prefixes: string[];
  includeValues: boolean;
};

type ConnectedTab = {
  tabId: string;
  sessionId: string;
  url: string | null;
  title: string | null;
  userAgent: string | null;
  reviewerName: string | null;
  connectedAt: number;
  lastSeenAt: number;
  connected: boolean;
};

type ConnectedAgent = {
  agentId: string;
  sessionId: string;
  endpoint: string | null;
  kind: string;
  userAgent: string | null;
  connectedAt: number;
  lastSeenAt: number;
  connected: boolean;
};

type KvStoredEntry = {
  key: string;
  value: unknown;
  version: number;
  updatedAt: number;
};

type KvTransactionCheckOp = {
  op: "check";
  key: string;
  exists?: boolean;
  value?: unknown;
};

type KvTransactionPutOp = {
  op: "put";
  key: string;
  value: unknown;
};

type KvTransactionDeleteOp = {
  op: "delete";
  key: string;
};

export type KvTransactionOp = KvTransactionCheckOp | KvTransactionPutOp | KvTransactionDeleteOp;

export type KvTransactionResult =
  | { ok: true; commitVersion: number; changes: Array<{ op: "put" | "delete"; key: string; value?: unknown }> }
  | { ok: false; reason: "version_conflict"; currentVersion: number }
  | { ok: false; reason: "check_failed"; key: string; message: string };

type TabHelloMessage = {
  type: "tab_hello";
  url: string;
  title: string;
  userAgent: string;
  reviewerName: string;
  pageState?: "awaiting_init" | "active";
};

type DebugEvalResultMessage = {
  type: "debug_eval_result";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export class SessionDO extends DurableObject {
  private waiters: Waiter[] = [];
  private activityWaiters: ActivityWaiter[] = [];
  private connectionWaiters: ConnectionWaiter[] = [];
  private presenceWaiters: PresenceWaiter[] = [];
  private debugEvalWaiters = new Map<string, DebugEvalWaiter>();

  static getInstance(id: string) {
    const doId = env.SESSION.idFromName(id);
    return env.SESSION.get(doId) as DurableObjectStub<SessionDO>;
  }

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS plan (markdown TEXT, created_at INTEGER);
        CREATE TABLE IF NOT EXISTS threads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          line INTEGER,
          location_label TEXT,
          selection_text TEXT,
          selection_context TEXT,
          created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id INTEGER NOT NULL REFERENCES threads(id),
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value INTEGER);
        CREATE TABLE IF NOT EXISTS hunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT,
          file_path TEXT NOT NULL,
          old_start INTEGER NOT NULL,
          old_count INTEGER NOT NULL,
          new_start INTEGER NOT NULL,
          new_count INTEGER NOT NULL,
          header TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          description TEXT NOT NULL,
          hunk_ids TEXT NOT NULL,
          sections_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reviewed_hunks (
          public_id TEXT PRIMARY KEY,
          reviewed_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tabs (
          tab_id TEXT PRIMARY KEY,
          url TEXT,
          title TEXT,
          user_agent TEXT,
          reviewer_name TEXT,
          connected_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          connected INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
          agent_id TEXT PRIMARY KEY,
          endpoint TEXT,
          kind TEXT NOT NULL,
          user_agent TEXT,
          connected_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          connected INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv_commits (
          version INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE,
          changes_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN hunk_id TEXT");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN hunk_id skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE hunks ADD COLUMN public_id TEXT");
      } catch (error) {
        console.warn("ALTER TABLE hunks ADD COLUMN public_id skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE views ADD COLUMN sections_json TEXT NOT NULL DEFAULT '[]'");
      } catch (error) {
        console.warn("ALTER TABLE views ADD COLUMN sections_json skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN file_path TEXT");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN file_path skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN outdated INTEGER NOT NULL DEFAULT 0");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN outdated skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN location_label TEXT");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN location_label skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN selection_text TEXT");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN selection_text skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN selection_context TEXT");
      } catch (error) {
        console.warn("ALTER TABLE threads ADD COLUMN selection_context skipped", error);
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE tabs ADD COLUMN reviewer_name TEXT");
      } catch (error) {
        console.warn("ALTER TABLE tabs ADD COLUMN reviewer_name skipped", error);
      }
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS text_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      const existingHunks = ctx.storage.sql.exec<{
        id: number;
        public_id: string | null;
        file_path: string;
        old_start: number;
        old_count: number;
        new_start: number;
        new_count: number;
        header: string;
        content: string;
      }>(
        "SELECT id, public_id, file_path, old_start, old_count, new_start, new_count, header, content FROM hunks"
      ).toArray();
      for (const hunk of existingHunks) {
        if (hunk.public_id) continue;
        ctx.storage.sql.exec(
          "UPDATE hunks SET public_id = ? WHERE id = ?",
          createPublicHunkId({
            filePath: hunk.file_path,
            oldStart: hunk.old_start,
            oldCount: hunk.old_count,
            newStart: hunk.new_start,
            newCount: hunk.new_count,
            header: hunk.header,
            content: hunk.content,
          }),
          hunk.id
        );
      }
    });

  }

  private async touchSession(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TTL_MS);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.waiters = [];
    this.activityWaiters = [];
    this.connectionWaiters = [];
    this.presenceWaiters = [];
    this.debugEvalWaiters.clear();
  }

  private getSessionId(): string | null {
    const rows = this.ctx.storage.sql.exec<{ value: string }>(
      "SELECT value FROM state WHERE key = 'session_id'"
    ).toArray();
    return rows.length > 0 ? rows[0].value : null;
  }

  private rememberSessionId(sessionId: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('session_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      sessionId
    );
  }

  async initializeBootstrapSession(sessionId: string, toolId: ToolId): Promise<void> {
    await this.touchSession();
    this.rememberSessionId(sessionId);
    await this.setToolId(toolId);
    await this.setSessionPhase("awaiting_init");
  }

  async activateSession(): Promise<void> {
    await this.setSessionPhase("active");
  }

  async setToolId(toolId: ToolId): Promise<void> {
    await this.touchSession();
    const value =
      toolId === "diff" ? 1 : toolId === "present" ? 2 : toolId === "playground" ? 3 : toolId === "share" ? 4 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('tool_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getToolId(): Promise<ToolId | null> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'tool_id'"
    ).toArray();
    if (rows.length === 0) return null;
    if (rows[0].value === 1) return "diff";
    if (rows[0].value === 2) return "present";
    if (rows[0].value === 3) return "playground";
    if (rows[0].value === 4) return "share";
    return "review";
  }

  async setSessionPhase(phase: SessionPhase): Promise<void> {
    await this.touchSession();
    const value = phase === "active" ? 1 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('session_phase', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getSessionPhase(): Promise<SessionPhase> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'session_phase'"
    ).toArray();
    if (rows.length === 0) return "awaiting_init";
    return rows[0].value === 1 ? "active" : "awaiting_init";
  }

  private getTabAttachment(ws: WebSocket): TabAttachment | null {
    const attachable = ws as WebSocket & {
      deserializeAttachment?: () => unknown;
    };
    const value = attachable.deserializeAttachment?.();
    if (!value || typeof value !== "object") return null;
    const maybe = value as { kind?: unknown; tabId?: unknown };
    if (maybe.kind !== "tab") return null;
    return typeof maybe.tabId === "string" ? { kind: "tab", tabId: maybe.tabId } : null;
  }

  private getKvStreamAttachment(ws: WebSocket): KvStreamAttachment | null {
    const attachable = ws as WebSocket & {
      deserializeAttachment?: () => unknown;
    };
    const value = attachable.deserializeAttachment?.();
    if (!value || typeof value !== "object") return null;
    const maybe = value as { kind?: unknown; prefixes?: unknown; includeValues?: unknown };
    if (maybe.kind !== "kv_stream" || !Array.isArray(maybe.prefixes)) return null;
    const prefixes = maybe.prefixes.filter((prefix): prefix is string => typeof prefix === "string");
    if (prefixes.length !== maybe.prefixes.length) return null;
    return {
      kind: "kv_stream",
      prefixes,
      includeValues: maybe.includeValues === true,
    };
  }

  private async upsertTabRecord(
    tabId: string,
    sessionId: string,
    patch: Partial<Omit<ConnectedTab, "tabId" | "sessionId">> = {}
  ) {
    await this.touchSession();
    const now = patch.lastSeenAt ?? Date.now();
    const existing = this.ctx.storage.sql.exec<{
      url: string | null;
      title: string | null;
      user_agent: string | null;
      reviewer_name: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      "SELECT url, title, user_agent, reviewer_name, connected_at, last_seen_at, connected FROM tabs WHERE tab_id = ? LIMIT 1",
      tabId
    ).toArray()[0];

    const record: ConnectedTab = {
      tabId,
      sessionId,
      url: patch.url ?? existing?.url ?? null,
      title: patch.title ?? existing?.title ?? null,
      userAgent: patch.userAgent ?? existing?.user_agent ?? null,
      reviewerName: patch.reviewerName ?? existing?.reviewer_name ?? null,
      connectedAt: patch.connectedAt ?? existing?.connected_at ?? now,
      lastSeenAt: now,
      connected: patch.connected ?? (existing ? existing.connected === 1 : true),
    };

    this.ctx.storage.sql.exec(
      `
        INSERT INTO tabs (tab_id, url, title, user_agent, reviewer_name, connected_at, last_seen_at, connected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tab_id) DO UPDATE SET
          url = excluded.url,
          title = excluded.title,
          user_agent = excluded.user_agent,
          reviewer_name = excluded.reviewer_name,
          connected_at = excluded.connected_at,
          last_seen_at = excluded.last_seen_at,
          connected = excluded.connected
      `,
      record.tabId,
      record.url,
      record.title,
      record.userAgent,
      record.reviewerName,
      record.connectedAt,
      record.lastSeenAt,
      record.connected ? 1 : 0
    );
    await this.resolvePresenceWaiters();
    await this.broadcastPresence();
  }

  private async markTabDisconnected(tabId: string) {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "UPDATE tabs SET connected = 0, last_seen_at = ? WHERE tab_id = ?",
      Date.now(),
      tabId
    );
    await this.resolvePresenceWaiters();
    await this.broadcastPresence();
  }

  private async broadcastPresence() {
    const tabs = await this.listConnectedTabs();
    this.broadcast({
      type: "presence",
      tabs: tabs.map((tab) => ({
        tabId: tab.tabId,
        reviewerName: tab.reviewerName,
        connected: tab.connected,
      })),
    });
  }

  async listConnectedTabs(): Promise<ConnectedTab[]> {
    const sessionId = this.getSessionId();
    const rows = this.ctx.storage.sql.exec<{
      tab_id: string;
      url: string | null;
      title: string | null;
      user_agent: string | null;
      reviewer_name: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT tab_id, url, title, user_agent, reviewer_name, connected_at, last_seen_at, connected
        FROM tabs
        WHERE connected = 1
        ORDER BY connected_at ASC, tab_id ASC
      `
    ).toArray();
    return rows.map((row) => ({
      tabId: row.tab_id,
      sessionId: sessionId ?? "",
      url: row.url,
      title: row.title,
      userAgent: row.user_agent,
      reviewerName: row.reviewer_name,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      connected: row.connected === 1,
    }));
  }

  async hasConnectedHumanTabs(): Promise<boolean> {
    const rows = this.ctx.storage.sql.exec<{ present: number }>(
      "SELECT 1 as present FROM tabs WHERE connected = 1 LIMIT 1"
    ).toArray();
    return rows.length > 0;
  }

  async startAgentConnection(input: {
    sessionId: string;
    endpoint: string | null;
    kind: string;
    userAgent: string | null;
  }): Promise<
    | { ok: true; agentId: string }
    | { ok: false; status: 409; message: string }
  > {
    await this.touchSession();
    this.rememberSessionId(input.sessionId);
    const existing = this.ctx.storage.sql.exec<{ agent_id: string }>(
      "SELECT agent_id FROM agents WHERE connected = 1 LIMIT 1"
    ).toArray();
    if (existing.length > 0) {
      return {
        ok: false,
        status: 409,
        message:
          "Another agent is already waiting on this session. Wait for that request to finish before starting a new poll.",
      };
    }
    const agentId = createCompactId();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `
        INSERT INTO agents (agent_id, endpoint, kind, user_agent, connected_at, last_seen_at, connected)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      agentId,
      input.endpoint,
      input.kind,
      input.userAgent,
      now,
      now
    );
    return { ok: true, agentId };
  }

  async endAgentConnection(agentId: string): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "UPDATE agents SET connected = 0, last_seen_at = ? WHERE agent_id = ?",
      Date.now(),
      agentId
    );
  }

  async listConnectedAgents(): Promise<ConnectedAgent[]> {
    const sessionId = this.getSessionId();
    const rows = this.ctx.storage.sql.exec<{
      agent_id: string;
      endpoint: string | null;
      kind: string;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT agent_id, endpoint, kind, user_agent, connected_at, last_seen_at, connected
        FROM agents
        WHERE connected = 1
        ORDER BY connected_at ASC, agent_id ASC
      `
    ).toArray();
    return rows.map((row) => ({
      agentId: row.agent_id,
      sessionId: sessionId ?? "",
      endpoint: row.endpoint,
      kind: row.kind,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      connected: row.connected === 1,
    }));
  }

  async hasConnectedAgents(): Promise<boolean> {
    const rows = this.ctx.storage.sql.exec<{ present: number }>(
      "SELECT 1 as present FROM agents WHERE connected = 1 LIMIT 1"
    ).toArray();
    return rows.length > 0;
  }

  async hasConnectedAgentKind(kind: string): Promise<boolean> {
    const rows = this.ctx.storage.sql.exec<{ present: number }>(
      "SELECT 1 as present FROM agents WHERE connected = 1 AND kind = ? LIMIT 1",
      kind
    ).toArray();
    return rows.length > 0;
  }

  async debugEvalTab(
    tabId: string,
    code: string,
    timeoutMs: number = 30_000
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const tabs = await this.listConnectedTabs();
    if (!tabs.some((tab) => tab.tabId === tabId)) {
      throw new Error(`Connected tab ${tabId} not found in this session`);
    }

    const target = this.findWebSocketByTabId(tabId);
    if (!target) {
      await this.markTabDisconnected(tabId);
      throw new Error(`Connected tab ${tabId} is no longer reachable`);
    }

    const requestId = createCompactId();

    return await new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.debugEvalWaiters.delete(requestId);
        reject(new Error(`Timed out waiting for tab ${tabId} to finish debug evaluation`));
      }, timeoutMs);

      this.debugEvalWaiters.set(requestId, {
        tabId,
        resolve,
        reject,
        timer,
      });

      try {
        target.send(
          JSON.stringify({
            type: "debug_eval",
            requestId,
            code,
          })
        );
      } catch (error) {
        console.error(`Failed to send debug_eval request to tab ${tabId}`, error);
        clearTimeout(timer);
        this.debugEvalWaiters.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private findWebSocketByTabId(tabId: string): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.getTabAttachment(ws);
      if (attachment?.tabId === tabId) {
        return ws;
      }
    }
    return null;
  }

  async markDone(): Promise<void> {
    await this.touchSession();
    await this.finalizeSessionDone();
  }

  async setDocReviewState(state: "ready" | "processing" | "complete"): Promise<void> {
    await this.touchSession();
    const value = state === "processing" ? 1 : state === "complete" ? 2 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('doc_review_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getDocReviewState(): Promise<"ready" | "processing" | "complete"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'doc_review_state'"
    ).toArray();
    if (rows.length === 0) return "ready";
    if (rows[0].value === 1) return "processing";
    if (rows[0].value === 2) return "complete";
    return "ready";
  }

  async completeDocReview(): Promise<void> {
    await this.touchSession();
    await this.setDocReviewState("complete");
    await this.finalizeSessionDone();
  }

  private async finalizeSessionDone(): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('done', 1) ON CONFLICT(key) DO UPDATE SET value = 1"
    );
    this.broadcast({ type: "done" });
    this.resolveWaiters();
  }

  async isDone(): Promise<boolean> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'done'"
    ).toArray();
    return rows.length > 0 && rows[0].value === 1;
  }

  async setContent(content: string): Promise<void> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM plan");
    sql.exec("INSERT INTO plan (markdown, created_at) VALUES (?, ?)", content, Date.now());
  }

  async getContent(): Promise<{ content: string; created_at: number } | null> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ markdown: string; created_at: number }>(
      "SELECT markdown, created_at FROM plan LIMIT 1"
    ).toArray();
    return rows.length > 0 ? { content: rows[0].markdown, created_at: rows[0].created_at } : null;
  }

  async setContentType(type: "plan" | "diff" | "files" | "playground" | "present" | "share"): Promise<void> {
    await this.touchSession();
    const value =
      type === "diff" ? 1 : type === "files" ? 2 : type === "playground" ? 3 : type === "present" ? 4 : type === "share" ? 5 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('content_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getContentType(): Promise<"plan" | "diff" | "files" | "playground" | "present" | "share"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'content_type'"
    ).toArray();
    if (rows.length === 0) return "plan";
    if (rows[0].value === 1) return "diff";
    if (rows[0].value === 2) return "files";
    if (rows[0].value === 3) return "playground";
    if (rows[0].value === 4) return "present";
    if (rows[0].value === 5) return "share";
    return "plan";
  }

  async setEncryptionMode(mode: "plain" | "e2e"): Promise<void> {
    await this.touchSession();
    const value = mode === "e2e" ? 1 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('encryption_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getEncryptionMode(): Promise<"plain" | "e2e"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'encryption_mode'"
    ).toArray();
    if (rows.length === 0) return "plain";
    return rows[0].value === 1 ? "e2e" : "plain";
  }

  async setReviewMode(mode: "doc" | "files"): Promise<void> {
    await this.touchSession();
    const value = mode === "doc" ? 1 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('review_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getReviewMode(): Promise<"doc" | "files"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'review_mode'"
    ).toArray();
    if (rows.length === 0) return "files";
    return rows[0].value === 1 ? "doc" : "files";
  }

  async getKvVersion(): Promise<number> {
    const row = this.ctx.storage.sql.exec<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) as version FROM kv_commits"
    ).one();
    return row?.version ?? 0;
  }

  async getKvEntry(key: string): Promise<KvStoredEntry | null> {
    const row = this.ctx.storage.sql.exec<{
      key: string;
      value_json: string;
      updated_version: number;
      updated_at: number;
    }>(
      "SELECT key, value_json, updated_version, updated_at FROM kv_store WHERE key = ? LIMIT 1",
      key
    ).toArray()[0];
    if (!row) return null;
    return {
      key: row.key,
      value: JSON.parse(row.value_json),
      version: row.updated_version,
      updatedAt: row.updated_at,
    };
  }

  async scanKv(prefix: string, after: string | null, limit: number): Promise<KvStoredEntry[]> {
    const sql = this.ctx.storage.sql;
    const normalizedLimit = Math.max(1, Math.min(limit, 500));
    const params: unknown[] = [`${escapeSqlLikePattern(prefix)}%`];
    let query = `
      SELECT key, value_json, updated_version, updated_at
      FROM kv_store
      WHERE key LIKE ? ESCAPE '\\'
    `;
    if (after) {
      query += " AND key > ?";
      params.push(after);
    }
    query += " ORDER BY key LIMIT ?";
    params.push(normalizedLimit);
    const rows = sql.exec<{
      key: string;
      value_json: string;
      updated_version: number;
      updated_at: number;
    }>(query, ...params).toArray();
    return rows.map((row) => ({
      key: row.key,
      value: JSON.parse(row.value_json),
      version: row.updated_version,
      updatedAt: row.updated_at,
    }));
  }

  async executeKvTransaction(args: {
    baseVersion?: number | null;
    idempotencyKey?: string | null;
    ops: KvTransactionOp[];
  }): Promise<KvTransactionResult> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    if (args.idempotencyKey) {
      const existing = sql.exec<{ version: number; changes_json: string }>(
        "SELECT version, changes_json FROM kv_commits WHERE idempotency_key = ? LIMIT 1",
        args.idempotencyKey
      ).toArray()[0];
      if (existing) {
        return {
          ok: true,
          commitVersion: existing.version,
          changes: JSON.parse(existing.changes_json) as Array<{ op: "put" | "delete"; key: string; value?: unknown }>,
        };
      }
    }

    const currentVersion = await this.getKvVersion();
    if (args.baseVersion != null && args.baseVersion !== currentVersion) {
      return { ok: false, reason: "version_conflict", currentVersion };
    }

    for (const op of args.ops) {
      if (!op.key || /\s/.test(op.key)) {
        throw new Error(`Invalid kv key: ${op.key}`);
      }
      if (op.op === "check") {
        const existing = await this.getKvEntry(op.key);
        if (typeof op.exists === "boolean" && op.exists !== (existing != null)) {
          return {
            ok: false,
            reason: "check_failed",
            key: op.key,
            message: op.exists
              ? `Expected ${op.key} to exist.`
              : `Expected ${op.key} to be absent.`,
          };
        }
        if ("value" in op) {
          const expected = JSON.stringify(op.value ?? null);
          const actual = existing ? JSON.stringify(existing.value) : null;
          if (actual !== expected) {
            return {
              ok: false,
              reason: "check_failed",
              key: op.key,
              message: `Expected ${op.key} to match the requested value.`,
            };
          }
        }
      }
    }

    const changeSet = args.ops.filter(
      (op): op is KvTransactionPutOp | KvTransactionDeleteOp => op.op === "put" || op.op === "delete"
    );
    if (changeSet.length === 0) {
      return { ok: true, commitVersion: currentVersion, changes: [] };
    }

    const now = Date.now();
    try {
      const committed = this.ctx.storage.transactionSync(() => {
        sql.exec(
          "INSERT INTO kv_commits (idempotency_key, changes_json, created_at) VALUES (?, ?, ?)",
          args.idempotencyKey ?? null,
          JSON.stringify(
            changeSet.map((op) =>
              op.op === "put"
                ? { op: "put" as const, key: op.key, value: op.value }
                : { op: "delete" as const, key: op.key }
            )
          ),
          now
        );
        const commitVersion = sql.exec<{ version: number }>(
          "SELECT last_insert_rowid() as version"
        ).one().version;

        for (const op of changeSet) {
          if (op.op === "put") {
            sql.exec(
              `
                INSERT INTO kv_store (key, value_json, updated_version, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  value_json = excluded.value_json,
                  updated_version = excluded.updated_version,
                  updated_at = excluded.updated_at
              `,
              op.key,
              JSON.stringify(op.value),
              commitVersion,
              now
            );
          } else {
            sql.exec("DELETE FROM kv_store WHERE key = ?", op.key);
          }
        }

        return {
          commitVersion,
          changes: changeSet.map((op) =>
            op.op === "put"
              ? { op: "put" as const, key: op.key, value: op.value }
              : { op: "delete" as const, key: op.key }
          ),
        };
      });

      this.broadcastKvCommit(committed.commitVersion, committed.changes);
      return { ok: true, commitVersion: committed.commitVersion, changes: committed.changes };
    } catch (error) {
      console.error("Failed to execute kv transaction", error);
      throw error;
    }
  }

  async setResult(text: string): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "INSERT INTO text_state (key, value) VALUES ('result', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      text
    );
  }

  async getResult(): Promise<string | null> {
    const rows = this.ctx.storage.sql.exec<{ value: string }>(
      "SELECT value FROM text_state WHERE key = 'result'"
    ).toArray();
    return rows.length > 0 ? rows[0].value : null;
  }

  async setDescription(text: string): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "INSERT INTO text_state (key, value) VALUES ('description', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      text
    );
  }

  async getDescription(): Promise<string | null> {
    const rows = this.ctx.storage.sql.exec<{ value: string }>(
      "SELECT value FROM text_state WHERE key = 'description'"
    ).toArray();
    return rows.length > 0 ? rows[0].value : null;
  }

  async getAllHunks(): Promise<{ id: string; filePath: string; oldStart: number; oldCount: number; newStart: number; newCount: number; header: string; content: string }[]> {
    const rows = this.ctx.storage.sql.exec<{
      public_id: string; file_path: string;
      old_start: number; old_count: number; new_start: number; new_count: number;
      header: string; content: string;
    }>(
      "SELECT public_id, file_path, old_start, old_count, new_start, new_count, header, content FROM hunks ORDER BY id"
    ).toArray();
    return rows.map((row) => ({
      id: row.public_id,
      filePath: row.file_path,
      oldStart: row.old_start,
      oldCount: row.old_count,
      newStart: row.new_start,
      newCount: row.new_count,
      header: row.header,
      content: row.content,
    }));
  }

  async markOutdatedThreads(newHunkIds: Set<string>): Promise<void> {
    // Mark threads whose hunk_id is not in the new set as outdated
    this.ctx.storage.sql.exec(
      "UPDATE threads SET outdated = 1 WHERE hunk_id IS NOT NULL AND hunk_id NOT IN (SELECT value FROM json_each(?))",
      JSON.stringify([...newHunkIds])
    );
    // Reset threads whose hunk_id IS in the new set
    this.ctx.storage.sql.exec(
      "UPDATE threads SET outdated = 0 WHERE hunk_id IS NOT NULL AND hunk_id IN (SELECT value FROM json_each(?))",
      JSON.stringify([...newHunkIds])
    );
  }

  async replaceFiles(files: { path: string; content: string }[]): Promise<void> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec("DELETE FROM files");
    for (const f of files) {
      sql.exec(
        "INSERT INTO files (path, content, created_at) VALUES (?, ?, ?)",
        f.path, f.content, now
      );
    }
  }

  async getAllFiles(): Promise<{ path: string; content: string }[]> {
    const rows = this.ctx.storage.sql.exec<{ path: string; content: string }>(
      "SELECT path, content FROM files ORDER BY id"
    ).toArray();
    return rows;
  }

  async clearStructuredContent(): Promise<void> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM plan");
    sql.exec("DELETE FROM files");
    sql.exec("DELETE FROM hunks");
    sql.exec("DELETE FROM text_state");
  }

  async markOutdatedFileThreads(currentPaths: Set<string>): Promise<void> {
    await this.touchSession();
    // Mark threads whose file_path is not in the current set as outdated
    this.ctx.storage.sql.exec(
      "UPDATE threads SET outdated = 1 WHERE file_path IS NOT NULL AND hunk_id IS NULL AND file_path NOT IN (SELECT value FROM json_each(?))",
      JSON.stringify([...currentPaths])
    );
    // Reset threads whose file_path IS in the current set
    this.ctx.storage.sql.exec(
      "UPDATE threads SET outdated = 0 WHERE file_path IS NOT NULL AND hunk_id IS NULL AND file_path IN (SELECT value FROM json_each(?))",
      JSON.stringify([...currentPaths])
    );
  }

  async markOutdatedDocThreads(): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "UPDATE threads SET outdated = 1 WHERE hunk_id IS NULL AND file_path IS NULL"
    );
  }

  async markAllThreadsOutdated(): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec("UPDATE threads SET outdated = 1");
  }

  private async createStandaloneThread(
    role: string,
    text: string,
    line: number | null = null,
    hunkId?: string | null,
    filePath?: string | null,
    metadata?: {
      locationLabel?: string | null;
      selectionText?: string | null;
      selectionContext?: string | null;
    }
  ): Promise<Thread> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    if (role === "human") {
      await this.markHumanConnected();
    }

    sql.exec(
      "INSERT INTO threads (line, hunk_id, file_path, location_label, selection_text, selection_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      line,
      hunkId ?? null,
      filePath ?? null,
      metadata?.locationLabel ?? null,
      metadata?.selectionText ?? null,
      metadata?.selectionContext ?? null,
      now
    );
    const threadId = sql.exec<{ id: number }>(
      "SELECT last_insert_rowid() as id"
    ).one().id;

    sql.exec(
      "INSERT INTO messages (thread_id, role, text, created_at) VALUES (?, ?, ?, ?)",
      threadId, role, text, now
    );
    const messageId = sql.exec<{ id: number }>(
      "SELECT last_insert_rowid() as id"
    ).one().id;

    const thread: Thread = {
      id: threadId,
      hunk_id: hunkId ?? null,
      line,
      file_path: filePath ?? null,
      location_label: metadata?.locationLabel ?? null,
      selection_text: metadata?.selectionText ?? null,
      selection_context: metadata?.selectionContext ?? null,
      outdated: false,
      created_at: now,
      messages: [{ id: messageId, thread_id: threadId, role, text, created_at: now }],
    };

    this.broadcast({ type: "thread", thread });
    return thread;
  }

  async createThread(
    line: number | null,
    text: string,
    hunkId?: string | null,
    filePath?: string | null,
    metadata?: {
      locationLabel?: string | null;
      selectionText?: string | null;
      selectionContext?: string | null;
    }
  ): Promise<Thread> {
    return this.createStandaloneThread("human", text, line, hunkId, filePath, metadata);
  }

  async createAgentThread(text: string): Promise<Thread> {
    return this.createStandaloneThread("agent", text, null, null, null);
  }

  async resetDone(): Promise<void> {
    await this.touchSession();
    this.ctx.storage.sql.exec(
      "DELETE FROM state WHERE key = 'done'"
    );
  }

  async addMessage(threadId: number, role: string, text: string): Promise<Message> {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    // Verify thread exists
    const threads = sql.exec<{ id: number }>(
      "SELECT id FROM threads WHERE id = ?", threadId
    ).toArray();
    if (threads.length === 0) {
      throw new Error(`Thread ${threadId} not found`);
    }

    sql.exec(
      "INSERT INTO messages (thread_id, role, text, created_at) VALUES (?, ?, ?, ?)",
      threadId, role, text, now
    );
    const messageId = sql.exec<{ id: number }>(
      "SELECT last_insert_rowid() as id"
    ).one().id;

    const message: Message = { id: messageId, thread_id: threadId, role, text, created_at: now };

    if (role === "human") {
      await this.markHumanConnected();
    }

    this.broadcast({ type: "message", message });

    return message;
  }

  async replaceHunks(hunks: StoredHunkInput[]) {
    await this.touchSession();
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec("DELETE FROM hunks");
    const meta: { id: string; file: string; oldStart: number; oldCount: number; newStart: number; newCount: number; preview: string }[] = [];
    for (const h of hunks) {
      const publicId = createPublicHunkId(h);
      sql.exec(
        "INSERT INTO hunks (public_id, file_path, old_start, old_count, new_start, new_count, header, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        publicId, h.filePath, h.oldStart, h.oldCount, h.newStart, h.newCount, h.header, h.content, now
      );
      meta.push({
        id: publicId,
        file: h.filePath,
        oldStart: h.oldStart,
        oldCount: h.oldCount,
        newStart: h.newStart,
        newCount: h.newCount,
        preview: formatPreview(h),
      });
    }
    return meta;
  }

  async getHunkMeta() {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ public_id: string; file_path: string; old_start: number; old_count: number; new_start: number; new_count: number; content: string }>(
      "SELECT public_id, file_path, old_start, old_count, new_start, new_count, content FROM hunks ORDER BY id"
    ).toArray();
    return rows.map((r) => {
      return {
        id: r.public_id,
        file: r.file_path,
        oldStart: r.old_start,
        oldCount: r.old_count,
        newStart: r.new_start,
        newCount: r.new_count,
        preview: formatPreview({
          oldStart: r.old_start,
          newStart: r.new_start,
          content: r.content,
        }),
      };
    });
  }

  async getHunksByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const sql = this.ctx.storage.sql;
    const placeholders = ids.map(() => "?").join(",");
    const rows = sql.exec<{ public_id: string; file_path: string; old_start: number; old_count: number; new_start: number; new_count: number; header: string; content: string }>(
      `SELECT public_id, file_path, old_start, old_count, new_start, new_count, header, content FROM hunks WHERE public_id IN (${placeholders})`,
      ...ids
    ).toArray();
    const rowsById = new Map(rows.map((row) => [row.public_id, row]));
    return ids.flatMap((id) => {
      const row = rowsById.get(id);
      if (!row) return [];
      return [{
        id: row.public_id,
        filePath: row.file_path,
        oldStart: row.old_start,
        oldCount: row.old_count,
        newStart: row.new_start,
        newCount: row.new_count,
        header: row.header,
        content: row.content,
      }];
    });
  }

  async broadcastViewUpdate(): Promise<void> {
    await this.touchSession();
    this.broadcast({ type: "view" });
  }

  private getAllThreadsSync(): Thread[] {
    const sql = this.ctx.storage.sql;
    const threadRows = sql.exec<{
      id: number; hunk_id: string | null; line: number | null;
      file_path: string | null; location_label: string | null;
      selection_text: string | null; selection_context: string | null;
      outdated: number; created_at: number;
    }>(
      "SELECT id, hunk_id, line, file_path, location_label, selection_text, selection_context, outdated, created_at FROM threads ORDER BY id"
    ).toArray();

    const threads: Thread[] = [];
    for (const t of threadRows) {
      const messages = sql.exec(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        t.id
      ).toArray() as unknown as Message[];
      threads.push({
        id: t.id,
        hunk_id: t.hunk_id,
        line: t.line,
        file_path: t.file_path,
        location_label: t.location_label,
        selection_text: t.selection_text,
        selection_context: t.selection_context,
        outdated: t.outdated === 1,
        created_at: t.created_at,
        messages,
      });
    }
    return threads;
  }

  async getThreads(): Promise<Thread[]> {
    return this.getAllThreadsSync();
    return threads;
  }

  async waitForComments(timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<{ threads: Thread[]; done?: boolean; noHuman?: boolean }> {
    const done = await this.isDone();

    // Already done — return all threads immediately
    if (done) {
      const threads = await this.getThreads();
      return { threads, done: true };
    }

    // Wait for Done to be clicked
    return new Promise<{ threads: Thread[]; noHuman?: boolean }>(async (resolve) => {
      let noHumanTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let wakeResolve: ((value: { connected: boolean }) => void) | null = null;
      let registerPresenceWaiter: (() => void) | null = null;

      const finish = (value: { threads: Thread[]; noHuman?: boolean }) => {
        if (settled) return;
        settled = true;
        if (noHumanTimer) clearTimeout(noHumanTimer);
        this.waiters = this.waiters.filter((w) => w.resolve !== waiterResolve);
        this.presenceWaiters = this.presenceWaiters.filter((w) => w.resolve !== wakeResolve);
        resolve(value);
      };

      const beginNoHumanTimer = () => {
        if (noHumanTimer || settled) return;
        noHumanTimer = setTimeout(() => {
          noHumanTimer = null;
          finish({ threads: [], noHuman: true });
        }, 5_000);
      };

      const stopNoHumanTimer = () => {
        if (!noHumanTimer) return;
        clearTimeout(noHumanTimer);
        noHumanTimer = null;
      };

      const timer = setTimeout(() => {
        finish({ threads: [] });
      }, timeoutMs);

      const waiterResolve = (value: { threads: Thread[]; done?: boolean }) => {
        clearTimeout(timer);
        stopNoHumanTimer();
        finish(value);
      };
      this.waiters.push({ resolve: waiterResolve, timer });

      wakeResolve = ({ connected }: { connected: boolean }) => {
        if (settled) return;
        if (connected) {
          stopNoHumanTimer();
        } else {
          beginNoHumanTimer();
        }
        registerPresenceWaiter?.();
      };

      const initiallyConnected = await this.hasConnectedHumanTabs();
      if (!initiallyConnected) {
        beginNoHumanTimer();
      }
      registerPresenceWaiter = () => {
        const presenceTimer = setTimeout(() => {
          this.presenceWaiters = this.presenceWaiters.filter((w) => w.resolve !== wakeResolve);
        }, timeoutMs);
        this.presenceWaiters.push({ resolve: wakeResolve!, timer: presenceTimer });
      };
      registerPresenceWaiter();
    });
  }

  private resolveWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    const doneRows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'done'"
    ).toArray();
    const done = doneRows.length > 0 && doneRows[0].value === 1;

    const allThreads = this.getAllThreadsSync();
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve({ threads: allThreads, done: done || undefined });
    }

    const activityWaiters = this.activityWaiters;
    this.activityWaiters = [];
    for (const w of activityWaiters) {
      clearTimeout(w.timer);
      w.resolve({ done });
    }
  }

  async waitForActivity(timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<{ done: boolean }> {
    if (await this.isDone()) return { done: true };

    return new Promise<{ done: boolean }>((resolve) => {
      const timer = setTimeout(() => {
        this.activityWaiters = this.activityWaiters.filter((w) => w.resolve !== resolve);
        resolve({ done: false });
      }, timeoutMs);

      this.activityWaiters.push({ resolve, timer });
    });
  }

  async hasHumanConnected(): Promise<boolean> {
    return this.hasConnectedHumanTabs();
  }

  async waitForHumanConnection(timeoutMs: number): Promise<{ connected: boolean }> {
    if (await this.hasHumanConnected()) {
      return { connected: true };
    }

    return new Promise<{ connected: boolean }>((resolve) => {
      const timer = setTimeout(() => {
        this.connectionWaiters = this.connectionWaiters.filter((w) => w.resolve !== resolve);
        resolve({ connected: false });
      }, timeoutMs);

      this.connectionWaiters.push({ resolve, timer });
    });
  }

  private async markHumanConnected(): Promise<void> {
    const connectionWaiters = this.connectionWaiters;
    this.connectionWaiters = [];
    for (const waiter of connectionWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ connected: true });
    }
    await this.resolvePresenceWaiters();
  }

  private async resolvePresenceWaiters() {
    const connected = await this.hasConnectedHumanTabs();
    const waiters = this.presenceWaiters;
    this.presenceWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ connected });
    }
  }

  private broadcast(data: unknown) {
    const json = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.getKvStreamAttachment(ws)) continue;
      try {
        ws.send(json);
      } catch (error) {
        console.error("Failed to broadcast websocket message", error);
      }
    }
  }

  private broadcastKvCommit(
    commitVersion: number,
    changes: Array<{ op: "put" | "delete"; key: string; value?: unknown }>
  ) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.getKvStreamAttachment(ws);
      if (!attachment) continue;
      const matched = changes.filter((change) =>
        attachment.prefixes.length === 0
          ? true
          : attachment.prefixes.some((prefix) => change.key.startsWith(prefix))
      );
      if (matched.length === 0) continue;
      const payload = {
        type: "kv_commit",
        commitVersion,
        changes: matched.map((change) =>
          attachment.includeValues || change.op === "delete"
            ? change
            : { op: change.op, key: change.key }
        ),
      };
      try {
        ws.send(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to broadcast kv commit", error);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const sessionMatch = url.pathname.match(/^\/s\/([^/]+)\/ws$/);
    const kvStreamMatch = url.pathname.match(/^\/s\/([^/]+)\/kv\/ws$/);
    const sessionId = sessionMatch?.[1] ?? kvStreamMatch?.[1];
    if (!sessionId) {
      return new Response("Missing session id", { status: 400 });
    }

    this.rememberSessionId(sessionId);
    await this.touchSession();

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    const serverSocket = pair[1] as WebSocket & {
      serializeAttachment?: (value: unknown) => void;
    };
    if (kvStreamMatch) {
      const prefixes = url.searchParams.getAll("prefix");
      const includeValues = url.searchParams.get("values") === "1";
      serverSocket.serializeAttachment?.({
        kind: "kv_stream",
        prefixes,
        includeValues,
      } satisfies KvStreamAttachment);
      try {
        serverSocket.send(
          JSON.stringify({
            type: "kv_subscribed",
            currentVersion: await this.getKvVersion(),
            prefixes,
            includeValues,
          })
        );
      } catch (error) {
        console.error("Failed to send kv subscription acknowledgement", error);
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const tabId = createCompactId();
    await this.markHumanConnected();
    serverSocket.serializeAttachment?.({ kind: "tab", tabId } satisfies TabAttachment);
    await this.upsertTabRecord(tabId, sessionId, {
      url: `/s/${sessionId}`,
      userAgent: request.headers.get("user-agent"),
      connected: true,
    });
    try {
      serverSocket.send(JSON.stringify({ type: "tab_ready", tabId }));
    } catch (error) {
      console.error("Failed to send tab_ready websocket message", error);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    let data: TabHelloMessage | DebugEvalResultMessage;
    try {
      data = JSON.parse(message) as TabHelloMessage | DebugEvalResultMessage;
    } catch (error) {
      console.error("Failed to parse websocket message", error);
      return;
    }

    const attachment = this.getTabAttachment(ws);
    if (!attachment) return;
    const sessionId = this.getSessionId();
    if (!sessionId) return;

    if (data.type === "tab_hello") {
      await this.upsertTabRecord(attachment.tabId, sessionId, {
        url: data.url,
        title: data.title,
        userAgent: data.userAgent,
        reviewerName: data.reviewerName,
        connected: true,
      });
      if (data.pageState === "awaiting_init" && (await this.getSessionPhase()) === "active") {
        try {
          ws.send(JSON.stringify({ type: "view" }));
        } catch (error) {
          console.error("Failed to send websocket view message", error);
        }
      }
      return;
    }

    if (data.type === "debug_eval_result") {
      const waiter = this.debugEvalWaiters.get(data.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.debugEvalWaiters.delete(data.requestId);
      waiter.resolve({
        ok: data.ok,
        result: data.result,
        error: data.error,
      });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = this.getTabAttachment(ws);
    if (attachment) {
      await this.markTabDisconnected(attachment.tabId);
      for (const [requestId, waiter] of this.debugEvalWaiters) {
        if (waiter.tabId !== attachment.tabId) continue;
        clearTimeout(waiter.timer);
        this.debugEvalWaiters.delete(requestId);
        const error = new Error(`Tab ${attachment.tabId} disconnected before returning a debug result`);
        console.error(error.message, error);
        waiter.reject(error);
      }
    }
  }

  async webSocketError(ws: WebSocket) {
    const attachment = this.getTabAttachment(ws);
    if (attachment) {
      await this.markTabDisconnected(attachment.tabId);
    }
  }
}
