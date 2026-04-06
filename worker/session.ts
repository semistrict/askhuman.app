import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";

const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface Thread {
  id: number;
  hunk_id: number | null;
  line: number | null;
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

type Waiter = {
  resolve: (value: { threads: Thread[]; done?: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActivityWaiter = {
  resolve: (value: { done: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class SessionDO extends DurableObject {
  private waiters: Waiter[] = [];
  private activityWaiters: ActivityWaiter[] = [];

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
          created_at INTEGER NOT NULL
        );
      `);
      try {
        ctx.storage.sql.exec("ALTER TABLE threads ADD COLUMN hunk_id INTEGER");
      } catch {
        // Column already exists
      }
    });

  }

  async markDone(): Promise<void> {
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

  async setContentType(type: "plan" | "diff"): Promise<void> {
    const value = type === "diff" ? 1 : 0;
    this.ctx.storage.sql.exec(
      "INSERT INTO state (key, value) VALUES ('content_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value
    );
  }

  async getContentType(): Promise<"plan" | "diff"> {
    const rows = this.ctx.storage.sql.exec<{ value: number }>(
      "SELECT value FROM state WHERE key = 'content_type'"
    ).toArray();
    return rows.length > 0 && rows[0].value === 1 ? "diff" : "plan";
  }

  async createThread(line: number | null, text: string, hunkId?: number | null): Promise<Thread> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    sql.exec(
      "INSERT INTO threads (line, hunk_id, created_at) VALUES (?, ?, ?)",
      line, hunkId ?? null, now
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
      created_at: now,
      messages: [{ id: messageId, thread_id: threadId, role: "human", text, created_at: now }],
    };

    this.resolveWaiters();
    this.broadcast({ type: "thread", thread });

    return thread;
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

    // Only resolve waiters for human messages (agent polls for human comments)
    if (role === "human") {
      this.resolveWaiters();
    }

    this.broadcast({ type: "message", message });

    return message;
  }

  async storeHunks(hunks: { filePath: string; oldStart: number; oldCount: number; newStart: number; newCount: number; header: string; content: string }[]) {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const meta: { id: number; file: string; oldStart: number; oldCount: number; newStart: number; newCount: number; preview: { first: string; last: string } }[] = [];
    for (const h of hunks) {
      sql.exec(
        "INSERT INTO hunks (file_path, old_start, old_count, new_start, new_count, header, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        h.filePath, h.oldStart, h.oldCount, h.newStart, h.newCount, h.header, h.content, now
      );
      const id = sql.exec<{ id: number }>("SELECT last_insert_rowid() as id").one().id;
      const lines = h.content.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-"));
      meta.push({
        id,
        file: h.filePath,
        oldStart: h.oldStart,
        oldCount: h.oldCount,
        newStart: h.newStart,
        newCount: h.newCount,
        preview: {
          first: lines[0]?.slice(1) ?? "",
          last: lines.length > 1 ? lines[lines.length - 1].slice(1) : "",
        },
      });
    }
    return meta;
  }

  async getHunkMeta() {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ id: number; file_path: string; old_start: number; old_count: number; new_start: number; new_count: number; content: string }>(
      "SELECT id, file_path, old_start, old_count, new_start, new_count, content FROM hunks ORDER BY id"
    ).toArray();
    return rows.map((r) => {
      const lines = r.content.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-"));
      return {
        id: r.id,
        file: r.file_path,
        oldStart: r.old_start,
        oldCount: r.old_count,
        newStart: r.new_start,
        newCount: r.new_count,
        preview: {
          first: lines[0]?.slice(1) ?? "",
          last: lines.length > 1 ? lines[lines.length - 1].slice(1) : "",
        },
      };
    });
  }

  async getHunksByIds(ids: number[]) {
    if (ids.length === 0) return [];
    const sql = this.ctx.storage.sql;
    const placeholders = ids.map(() => "?").join(",");
    const rows = sql.exec<{ id: number; file_path: string; old_start: number; old_count: number; new_start: number; new_count: number; header: string; content: string }>(
      `SELECT id, file_path, old_start, old_count, new_start, new_count, header, content FROM hunks WHERE id IN (${placeholders}) ORDER BY id`,
      ...ids
    ).toArray();
    return rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      oldStart: r.old_start,
      oldCount: r.old_count,
      newStart: r.new_start,
      newCount: r.new_count,
      header: r.header,
      content: r.content,
    }));
  }

  async setView(description: string, hunkIds: number[]): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "INSERT INTO views (description, hunk_ids, created_at) VALUES (?, ?, ?)",
      description, JSON.stringify(hunkIds), Date.now()
    );
    this.broadcast({ type: "view", description, hunkIds });
  }

  async getView(): Promise<{ description: string; hunkIds: number[] } | null> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ description: string; hunk_ids: string }>(
      "SELECT description, hunk_ids FROM views ORDER BY id DESC LIMIT 1"
    ).toArray();
    if (rows.length === 0) return null;
    return { description: rows[0].description, hunkIds: JSON.parse(rows[0].hunk_ids) };
  }

  async getThreads(): Promise<Thread[]> {
    const sql = this.ctx.storage.sql;
    const threadRows = sql.exec<{ id: number; hunk_id: number | null; line: number | null; created_at: number }>(
      "SELECT id, hunk_id, line, created_at FROM threads ORDER BY id"
    ).toArray();

    const threads: Thread[] = [];
    for (const t of threadRows) {
      const messages = sql.exec(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        t.id
      ).toArray() as unknown as Message[];
      threads.push({ ...t, messages });
    }
    return threads;
  }

  async waitForComments(timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<{ threads: Thread[]; done?: boolean }> {
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
      return { ...this.collectAndAdvanceCursor(cursor), done: done || undefined };
    }

    // Already done with no unread comments — return immediately
    if (done) {
      return { threads: [], done: true };
    }

    // Wait for new activity
    return new Promise<{ threads: Thread[] }>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        const currentCursorRows = sql.exec<{ value: number }>(
          "SELECT value FROM state WHERE key = 'agent_cursor'"
        ).toArray();
        const currentCursor = currentCursorRows.length > 0 ? currentCursorRows[0].value : 0;
        const result = this.collectThreadsSinceCursor(currentCursor);
        if (result.threads.length > 0) {
          this.advanceCursor(result.threads);
          resolve(result);
        } else {
          resolve({ threads: [] });
        }
      }, timeoutMs);

      this.waiters.push({ resolve, timer });
    });
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
      const threadRows = sql.exec<{ id: number; hunk_id: number | null; line: number | null; created_at: number }>(
        "SELECT id, hunk_id, line, created_at FROM threads WHERE id = ?", tid
      ).toArray();
      if (threadRows.length === 0) continue;
      const t = threadRows[0];
      const messages = sql.exec(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        tid
      ).toArray() as unknown as Message[];
      threads.push({ ...t, messages });
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

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }
}
