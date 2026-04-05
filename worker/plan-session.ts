import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";

export interface Thread {
  id: number;
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
  resolve: (value: { threads: Thread[] }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActivityWaiter = {
  resolve: (value: { done: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class PlanSession extends DurableObject {
  private waiters: Waiter[] = [];
  private activityWaiters: ActivityWaiter[] = [];

  static getInstance(id: string) {
    const doId = env.PLAN_SESSION.idFromName(id);
    return env.PLAN_SESSION.get(doId) as DurableObjectStub<PlanSession>;
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
      `);
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

  async setPlan(markdown: string): Promise<void> {
    const sql = this.ctx.storage.sql;
    // Replace any existing plan
    sql.exec("DELETE FROM plan");
    sql.exec("INSERT INTO plan (markdown, created_at) VALUES (?, ?)", markdown, Date.now());
  }

  async getPlan(): Promise<{ markdown: string; created_at: number } | null> {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec<{ markdown: string; created_at: number }>(
      "SELECT markdown, created_at FROM plan LIMIT 1"
    ).toArray();
    return rows.length > 0 ? rows[0] : null;
  }

  async createThread(line: number | null, text: string): Promise<Thread> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    sql.exec(
      "INSERT INTO threads (line, created_at) VALUES (?, ?)",
      line, now
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

  async getThreads(): Promise<Thread[]> {
    const sql = this.ctx.storage.sql;
    const threadRows = sql.exec<{ id: number; line: number | null; created_at: number }>(
      "SELECT id, line, created_at FROM threads ORDER BY id"
    ).toArray();

    const threads: Thread[] = [];
    for (const t of threadRows) {
      const messages = sql.exec<Message>(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        t.id
      ).toArray();
      threads.push({ ...t, messages });
    }
    return threads;
  }

  async waitForComments(timeoutMs: number = 120000): Promise<{ threads: Thread[]; done?: boolean }> {
    const sql = this.ctx.storage.sql;

    // Check if review is done
    if (await this.isDone()) {
      return { threads: [], done: true };
    }

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

    if (newMessages.length > 0) {
      // Return all threads with messages since cursor
      return this.collectAndAdvanceCursor(cursor);
    }

    // Wait for new activity
    return new Promise<{ threads: Thread[] }>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        // Return empty on timeout — re-read cursor at that point
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

    // Get thread IDs that have new human messages
    const threadIds = sql.exec<{ thread_id: number }>(
      "SELECT DISTINCT thread_id FROM messages WHERE id > ? AND role = 'human'",
      cursor
    ).toArray().map((r) => r.thread_id);

    if (threadIds.length === 0) {
      return { threads: [] };
    }

    const threads: Thread[] = [];
    for (const tid of threadIds) {
      const threadRows = sql.exec<{ id: number; line: number | null; created_at: number }>(
        "SELECT id, line, created_at FROM threads WHERE id = ?", tid
      ).toArray();
      if (threadRows.length === 0) continue;
      const t = threadRows[0];
      const messages = sql.exec<Message>(
        "SELECT id, thread_id, role, text, created_at FROM messages WHERE thread_id = ? ORDER BY id",
        tid
      ).toArray();
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

    // Also notify activity waiters (no cursor advancement)
    const activityWaiters = this.activityWaiters;
    this.activityWaiters = [];
    for (const w of activityWaiters) {
      clearTimeout(w.timer);
      w.resolve({ done });
    }
  }

  /**
   * Wait for any new human activity (comments or done) without advancing the cursor.
   * Used by MCP watcher to detect changes without interfering with REST API polling.
   */
  async waitForActivity(timeoutMs: number = 120000): Promise<{ done: boolean }> {
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

  // WebSocket upgrade handler — only handles WS requests
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
    // Complete the WebSocket close handshake
    ws.close(code, reason);
  }
}
