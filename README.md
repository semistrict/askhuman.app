# askhuman.app

Human-in-the-loop review tools for AI agents. Sometimes your agent needs to phone a friend.

Agents submit plans via MCP or REST API. Humans review in their browser with threaded, line-specific comments. Agents reply. Loop until done.

**Live at [askhuman.app](https://askhuman.app)**

## Quick Start

**Claude Code:**
```
/plugin marketplace add semistrict/askhuman.app
/plugin install askhuman.app@askhuman
```

**Codex:**
```
codex mcp add askhuman --url https://askhuman.app/mcp
```

**Any agent (zero install):**
```
curl https://askhuman.app
```

## How It Works

1. Agent submits a markdown plan
2. Human reviews in browser, posts threaded comments (general or on specific lines)
3. Agent polls for comments, replies
4. Human sees replies in real-time via WebSocket
5. Loop until human clicks Done

## Interfaces

| Interface | Endpoint | Use |
|-----------|----------|-----|
| MCP | `https://askhuman.app/mcp` | Claude Code, Codex, any MCP client |
| REST | `https://askhuman.app/plan` | curl, fetch, any HTTP client |
| Browser | `https://askhuman.app/session/{id}` | Human reviewer UI |

## Development

```bash
pnpm install
pnpm run dev:vinext    # local dev server on port 3001
pnpm exec playwright test  # run tests (17 total: 10 REST + 7 MCP)
pnpm run deploy        # deploy to Cloudflare Workers
```

Requires: Node.js, pnpm, wrangler (Cloudflare CLI).

## Architecture

- **Runtime:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Framework:** vinext (Vite-based Next.js for Cloudflare)
- **MCP:** `@modelcontextprotocol/server` with Streamable HTTP transport
- **Real-time:** WebSocket (hibernation API) for browser updates

Two Durable Objects:
- `PlanSession` — stores plans, threads, messages (SQLite). Handles WebSocket for browser clients and long-polling for agents.
- `McpSession` — holds MCP server + transport per session. Routes MCP tool calls to PlanSession.

Shared interaction layer (`lib/plan-review.ts`) eliminates duplication between REST and MCP interfaces.

## Security Model

Sessions are identified by UUID. There is no authentication — the session ID is the sole access control. This is intentional for frictionless agent usage. Don't use this for sensitive content on a shared instance without understanding this tradeoff.

## License

MIT
