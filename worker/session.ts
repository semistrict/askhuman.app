import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { createCompactId } from "@/lib/compact-id";
import { DebugIndexDO } from "@/worker/debug-index";

const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface Thread {
  id: number;
  hunk_id: string | null;
  line: number | null;
  file_path: string | null;
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
  tabId: string;
};

type ConnectedTab = {
  tabId: string;
  sessionId: string;
  url: string | null;
  title: string | null;
  userAgent: string | null;
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

type TabHelloMessage = {
  type: "tab_hello";
  url: string;
  title: string;
  userAgent: string;
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
      `);
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN hunk_id TEXT");
      } catch {
        // Column already exists
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE hunks ADD COLUMN public_id TEXT");
      } catch {
        // Column already exists
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE views ADD COLUMN sections_json TEXT NOT NULL DEFAULT '[]'");
      } catch {
        // Column already exists
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN file_path TEXT");
      } catch {
        // Column already exists
      }
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN outdated INTEGER NOT NULL DEFAULT 0");
      } catch {
        // Column already exists
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

  private getDebugIndex() {
    return DebugIndexDO.getInstance();
  }

  private getTabAttachment(ws: WebSocket): TabAttachment | null {
    const attachable = ws as WebSocket & {
      deserializeAttachment?: () => unknown;
    };
    const value = attachable.deserializeAttachment?.();
    if (!value || typeof value !== "object") return null;
    const maybe = value as { tabId?: unknown };
    return typeof maybe.tabId === "string" ? { tabId: maybe.tabId } : null;
  }

  private async upsertTabRecord(
    tabId: string,
    sessionId: string,
    patch: Partial<Omit<ConnectedTab, "tabId" | "sessionId">> = {}
  ) {
    const now = patch.lastSeenAt ?? Date.now();
    const existing = this.ctx.storage.sql.exec<{
      url: string | null;
      title: string | null;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      "SELECT url, title, user_agent, connected_at, last_seen_at, connected FROM tabs WHERE tab_id = ? LIMIT 1",
      tabId
    ).toArray()[0];

    const record: ConnectedTab = {
      tabId,
      sessionId,
      url: patch.url ?? existing?.url ?? null,
      title: patch.title ?? existing?.title ?? null,
      userAgent: patch.userAgent ?? existing?.user_agent ?? null,
      connectedAt: patch.connectedAt ?? existing?.connected_at ?? now,
      lastSeenAt: now,
      connected: patch.connected ?? (existing ? existing.connected === 1 : true),
    };

    this.ctx.storage.sql.exec(
      `
        INSERT INTO tabs (tab_id, url, title, user_agent, connected_at, last_seen_at, connected)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tab_id) DO UPDATE SET
          url = excluded.url,
          title = excluded.title,
          user_agent = excluded.user_agent,
          connected_at = excluded.connected_at,
          last_seen_at = excluded.last_seen_at,
          connected = excluded.connected
      `,
      record.tabId,
      record.url,
      record.title,
      record.userAgent,
      record.connectedAt,
      record.lastSeenAt,
      record.connected ? 1 : 0
    );

    await this.getDebugIndex().upsertTab({
      tabId: record.tabId,
      sessionId: record.sessionId,
      url: record.url,
      title: record.title,
      userAgent: record.userAgent,
      connectedAt: record.connectedAt,
      lastSeenAt: record.lastSeenAt,
      connected: record.connected,
    });
    await this.resolvePresenceWaiters();
  }

  private async markTabDisconnected(tabId: string) {
    this.ctx.storage.sql.exec(
      "UPDATE tabs SET connected = 0, last_seen_at = ? WHERE tab_id = ?",
      Date.now(),
      tabId
    );
    await this.getDebugIndex().markTabDisconnected(tabId);
    await this.resolvePresenceWaiters();
  }

  async listConnectedTabs(): Promise<ConnectedTab[]> {
    const sessionId = this.getSessionId();
    const rows = this.ctx.storage.sql.exec<{
      tab_id: string;
      url: string | null;
      title: string | null;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT tab_id, url, title, user_agent, connected_at, last_seen_at, connected
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
  }): Promise<string> {
    this.rememberSessionId(input.sessionId);
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
    await this.getDebugIndex().upsertAgent({
      agentId,
      sessionId: input.sessionId,
      endpoint: input.endpoint,
      kind: input.kind,
      userAgent: input.userAgent,
      connectedAt: now,
      lastSeenAt: now,
      connected: true,
    });
    return agentId;
  }

  async endAgentConnection(agentId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE agents SET connected = 0, last_seen_at = ? WHERE agent_id = ?",
      Date.now(),
      agentId
    );
    await this.getDebugIndex().markAgentDisconnected(agentId);
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

  async setContentType(type: "plan" | "diff" | "files" | "playground"): Promise<void> {
    const value = type === "diff" ? 1 : type === "files" ? 2 : type === "playground" ? 3 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('content_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getContentType(): Promise<"plan" | "diff" | "files" | "playground"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'content_type'"
    ).toArray();
    if (rows.length === 0) return "plan";
    if (rows[0].value === 1) return "diff";
    if (rows[0].value === 2) return "files";
    if (rows[0].value === 3) return "playground";
    return "plan";
  }

  async setResult(text: string): Promise<void> {
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

  async markOutdatedFileThreads(currentPaths: Set<string>): Promise<void> {
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

  async createThread(line: number | null, text: string, hunkId?: string | null, filePath?: string | null): Promise<Thread> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    await this.markHumanConnected();

    sql.exec(
      "INSERT INTO threads (line, hunk_id, file_path, created_at) VALUES (?, ?, ?, ?)",
      line, hunkId ?? null, filePath ?? null, now
    );
    const threadId = sql.exec<{ id: number }>(
      "SELECT last_insert_rowid() as id"
    ).one().id;

    sql.exec(
      "INSERT INTO messages (thread_id, role, text, created_at) VALUES (?, ?, ?, ?)",
      threadId, "human", text, now
    );
    const messageId = sql.exec<{ id: number }>(
      "SELECT last_insert_rowid() as id"
    ).one().id;

    const thread: Thread = {
      id: threadId,
      hunk_id: hunkId ?? null,
      line,
      file_path: filePath ?? null,
      outdated: false,
      created_at: now,
      messages: [{ id: messageId, thread_id: threadId, role: "human", text, created_at: now }],
    };

    this.broadcast({ type: "thread", thread });

    return thread;
  }

  async resetDone(): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM state WHERE key = 'done'"
    );
  }

  async advanceCursorPastThreads(threadIds: number[]): Promise<void> {
    if (threadIds.length === 0) return;
    const sql = this.ctx.storage.sql;
    const placeholders = threadIds.map(() => "?").join(",");
    const rows = sql.exec<{ max_id: number }>(
      `SELECT MAX(id) as max_id FROM messages WHERE thread_id IN (${placeholders})`,
      ...threadIds
    ).toArray();
    if (rows.length === 0 || rows[0].max_id === null) return;
    const maxId = rows[0].max_id;
    const cursorRows = sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'agent_cursor'"
    ).toArray();
    const currentCursor = cursorRows.length > 0 ? cursorRows[0].value : 0;
    if (maxId > currentCursor) {
      sql.exec(
        "INSERT INTO state (key, value) VALUES ('agent_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        maxId
      );
    }
  }

  async addMessage(threadId: number, role: string, text: string): Promise<Message> {
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
    this.broadcast({ type: "view" });
  }

  async getThreads(): Promise<Thread[]> {
    const sql = this.ctx.storage.sql;
    const threadRows = sql.exec<{
      id: number; hunk_id: string | null; line: number | null;
      file_path: string | null; outdated: number; created_at: number;
    }>(
      "SELECT id, hunk_id, line, file_path, outdated, created_at FROM threads ORDER BY id"
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
        outdated: t.outdated === 1,
        created_at: t.created_at,
        messages,
      });
    }
    return threads;
  }

  async waitForComments(timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<{ threads: Thread[]; done?: boolean; noHuman?: boolean }> {
    const sql = this.ctx.storage.sql;

    // Get or initialize agent cursor
    const cursorRows = sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'agent_cursor'"
    ).toArray();
    const cursor = cursorRows.length > 0 ? cursorRows[0].value : 0;

    // Check for new human messages since cursor
    const newMessages = sql.exec<{ id: number }>(
      "SELECT id FROM messages WHERE id > ? AND role = 'human' LIMIT 1",
      cursor
    ).toArray();

    const done = await this.isDone();

    if (newMessages.length > 0) {
      return {
        ...this.collectAndAdvanceCursor(cursor),
        done: done || undefined,
      };
    }

    // Already done with no unread comments — return immediately
    if (done) {
      return { threads: [], done: true };
    }

    // Wait for new activity, but fail fast if no human tabs stay connected for 5s.
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
        const currentCursorRows = sql.exec<{ value: number }>(
          "SELECT value FROM state WHERE key = 'agent_cursor'"
        ).toArray();
        const currentCursor = currentCursorRows.length > 0 ? currentCursorRows[0].value : 0;
        const result = this.collectThreadsSinceCursor(currentCursor);
        if (result.threads.length > 0) {
          this.advanceCursor(result.threads);
          finish(result);
        } else {
          finish({ threads: [] });
        }
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

  async consumeAgentUpdate(): Promise<{ threads: Thread[]; done?: boolean }> {
    const sql = this.ctx.storage.sql;
    const cursorRows = sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'agent_cursor'"
    ).toArray();
    const cursor = cursorRows.length > 0 ? cursorRows[0].value : 0;
    const newMessages = sql.exec<{ id: number }>(
      "SELECT id FROM messages WHERE id > ? AND role = 'human' LIMIT 1",
      cursor
    ).toArray();
    const done = await this.isDone();

    if (newMessages.length > 0) {
      const result = this.collectAndAdvanceCursor(cursor);
      return { ...result, done: done || undefined };
    }
    if (done) {
      return { threads: [], done: true };
    }
    return { threads: [] };
  }

  private collectAndAdvanceCursor(cursor: number): { threads: Thread[] } {
    const result = this.collectThreadsSinceCursor(cursor);
    this.advanceCursor(result.threads);
    return result;
  }

  private collectThreadsSinceCursor(cursor: number): { threads: Thread[] } {
    const sql = this.ctx.storage.sql;

    const threadIds = sql.exec<{ thread_id: number }>(
      "SELECT DISTINCT thread_id FROM messages WHERE id > ? AND role = 'human'",
      cursor
    ).toArray().map((r) => r.thread_id);

    if (threadIds.length === 0) {
      return { threads: [] };
    }

    const threads: Thread[] = [];
    for (const tid of threadIds) {
      const threadRows = sql.exec<{
        id: number; hunk_id: string | null; line: number | null;
        file_path: string | null; outdated: number; created_at: number;
      }>(
        "SELECT id, hunk_id, line, file_path, outdated, created_at FROM threads WHERE id = ?", tid
      ).toArray();
      if (threadRows.length === 0) continue;
      const t = threadRows[0];
      const messages = sql.exec(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        tid
      ).toArray() as unknown as Message[];
      threads.push({
        id: t.id,
        hunk_id: t.hunk_id,
        line: t.line,
        file_path: t.file_path,
        outdated: t.outdated === 1,
        created_at: t.created_at,
        messages,
      });
    }

    return { threads };
  }

  private advanceCursor(threads: Thread[]) {
    const sql = this.ctx.storage.sql;
    let maxId = 0;
    for (const t of threads) {
      for (const m of t.messages) {
        if (m.id > maxId) maxId = m.id;
      }
    }
    if (maxId > 0) {
      sql.exec(
        "INSERT INTO state (key, value) VALUES ('agent_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        maxId
      );
    }
  }

  private resolveWaiters() {
    const waiters = this.waiters;
    this.waiters = [];
    const doneRows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'done'"
    ).toArray();
    const done = doneRows.length > 0 && doneRows[0].value === 1;

    for (const w of waiters) {
      clearTimeout(w.timer);
      const sql = this.ctx.storage.sql;
      const cursorRows = sql.exec<{ value: number }>(
        "SELECT value FROM state WHERE key = 'agent_cursor'"
      ).toArray();
      const cursor = cursorRows.length > 0 ? cursorRows[0].value : 0;
      const result = this.collectAndAdvanceCursor(cursor);
      if (done) {
        w.resolve({ ...result, done: true });
      } else {
        w.resolve(result);
      }
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
      try {
        ws.send(json);
      } catch {
        // Client disconnected
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const sessionMatch = new URL(request.url).pathname.match(/^\/s\/([^/]+)\/ws$/);
    const sessionId = sessionMatch?.[1];
    if (!sessionId) {
      return new Response("Missing session id", { status: 400 });
    }

    this.rememberSessionId(sessionId);

    const pair = new WebSocketPair();
    const tabId = createCompactId();
    await this.markHumanConnected();
    this.ctx.acceptWebSocket(pair[1]);
    const serverSocket = pair[1] as WebSocket & {
      serializeAttachment?: (value: unknown) => void;
    };
    serverSocket.serializeAttachment?.({ tabId } satisfies TabAttachment);
    await this.upsertTabRecord(tabId, sessionId, {
      url: `/s/${sessionId}`,
      userAgent: request.headers.get("user-agent"),
      connected: true,
    });
    try {
      serverSocket.send(JSON.stringify({ type: "tab_ready", tabId }));
    } catch {
      // Ignore eager send failures; the tab will still be tracked and updated by hello.
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    let data: TabHelloMessage | DebugEvalResultMessage;
    try {
      data = JSON.parse(message) as TabHelloMessage | DebugEvalResultMessage;
    } catch {
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
        connected: true,
      });
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
        waiter.reject(new Error(`Tab ${attachment.tabId} disconnected before returning a debug result`));
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
