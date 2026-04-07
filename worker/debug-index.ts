import { DurableObject } from "cloudflare:workers";
import { env } from "cloudflare:workers";

export type ConnectedTabRecord = {
  tabId: string;
  sessionId: string;
  url: string | null;
  title: string | null;
  userAgent: string | null;
  connectedAt: number;
  lastSeenAt: number;
  connected: boolean;
};

export type ConnectedAgentRecord = {
  agentId: string;
  sessionId: string;
  endpoint: string | null;
  kind: string;
  userAgent: string | null;
  connectedAt: number;
  lastSeenAt: number;
  connected: boolean;
};

type UpsertTabInput = {
  tabId: string;
  sessionId: string;
  url?: string | null;
  title?: string | null;
  userAgent?: string | null;
  connectedAt?: number;
  lastSeenAt?: number;
  connected?: boolean;
};

type UpsertAgentInput = {
  agentId: string;
  sessionId: string;
  endpoint?: string | null;
  kind: string;
  userAgent?: string | null;
  connectedAt?: number;
  lastSeenAt?: number;
  connected?: boolean;
};

export class DebugIndexDO extends DurableObject {
  static getInstance() {
    const id = env.DEBUG_INDEX.idFromName("global");
    return env.DEBUG_INDEX.get(id) as DurableObjectStub<DebugIndexDO>;
  }

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS tabs (
          tab_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          url TEXT,
          title TEXT,
          user_agent TEXT,
          connected_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          connected INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
          agent_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          endpoint TEXT,
          kind TEXT NOT NULL,
          user_agent TEXT,
          connected_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          connected INTEGER NOT NULL
        );
      `);
    });
  }

  async upsertTab(input: UpsertTabInput): Promise<void> {
    const now = input.lastSeenAt ?? Date.now();
    const connectedAt = input.connectedAt ?? now;
    this.ctx.storage.sql.exec(
      `
        INSERT INTO tabs (
          tab_id, session_id, url, title, user_agent, connected_at, last_seen_at, connected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tab_id) DO UPDATE SET
          session_id = excluded.session_id,
          url = excluded.url,
          title = excluded.title,
          user_agent = excluded.user_agent,
          connected_at = excluded.connected_at,
          last_seen_at = excluded.last_seen_at,
          connected = excluded.connected
      `,
      input.tabId,
      input.sessionId,
      input.url ?? null,
      input.title ?? null,
      input.userAgent ?? null,
      connectedAt,
      now,
      input.connected === false ? 0 : 1
    );
  }

  async markTabDisconnected(tabId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE tabs SET connected = 0, last_seen_at = ? WHERE tab_id = ?",
      Date.now(),
      tabId
    );
  }

  async listConnectedTabs(): Promise<ConnectedTabRecord[]> {
    const rows = this.ctx.storage.sql.exec<{
      tab_id: string;
      session_id: string;
      url: string | null;
      title: string | null;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT tab_id, session_id, url, title, user_agent, connected_at, last_seen_at, connected
        FROM tabs
        WHERE connected = 1
        ORDER BY connected_at ASC, tab_id ASC
      `
    ).toArray();
    return rows.map((row) => ({
      tabId: row.tab_id,
      sessionId: row.session_id,
      url: row.url,
      title: row.title,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      connected: row.connected === 1,
    }));
  }

  async getTab(tabId: string): Promise<ConnectedTabRecord | null> {
    const row = this.ctx.storage.sql.exec<{
      tab_id: string;
      session_id: string;
      url: string | null;
      title: string | null;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT tab_id, session_id, url, title, user_agent, connected_at, last_seen_at, connected
        FROM tabs
        WHERE tab_id = ?
        LIMIT 1
      `,
      tabId
    ).toArray()[0];
    if (!row) return null;
    return {
      tabId: row.tab_id,
      sessionId: row.session_id,
      url: row.url,
      title: row.title,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      connected: row.connected === 1,
    };
  }

  async upsertAgent(input: UpsertAgentInput): Promise<void> {
    const now = input.lastSeenAt ?? Date.now();
    const connectedAt = input.connectedAt ?? now;
    this.ctx.storage.sql.exec(
      `
        INSERT INTO agents (
          agent_id, session_id, endpoint, kind, user_agent, connected_at, last_seen_at, connected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          session_id = excluded.session_id,
          endpoint = excluded.endpoint,
          kind = excluded.kind,
          user_agent = excluded.user_agent,
          connected_at = excluded.connected_at,
          last_seen_at = excluded.last_seen_at,
          connected = excluded.connected
      `,
      input.agentId,
      input.sessionId,
      input.endpoint ?? null,
      input.kind,
      input.userAgent ?? null,
      connectedAt,
      now,
      input.connected === false ? 0 : 1
    );
  }

  async markAgentDisconnected(agentId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE agents SET connected = 0, last_seen_at = ? WHERE agent_id = ?",
      Date.now(),
      agentId
    );
  }

  async listConnectedAgents(): Promise<ConnectedAgentRecord[]> {
    const rows = this.ctx.storage.sql.exec<{
      agent_id: string;
      session_id: string;
      endpoint: string | null;
      kind: string;
      user_agent: string | null;
      connected_at: number;
      last_seen_at: number;
      connected: number;
    }>(
      `
        SELECT agent_id, session_id, endpoint, kind, user_agent, connected_at, last_seen_at, connected
        FROM agents
        WHERE connected = 1
        ORDER BY connected_at ASC, agent_id ASC
      `
    ).toArray();
    return rows.map((row) => ({
      agentId: row.agent_id,
      sessionId: row.session_id,
      endpoint: row.endpoint,
      kind: row.kind,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      connected: row.connected === 1,
    }));
  }
}
