# askhuman.app

Human-in-the-loop review tools for AI agents. Sometimes your agent needs to phone a friend.

Agents submit plans or diffs via curl. Humans review in their browser with threaded, line-specific comments. Agents poll and reply with curl. Loop until done.

**Live at [askhuman.app](https://askhuman.app)**

## Quick Start

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
| REST | `https://askhuman.app/plan` | curl, fetch, any HTTP client |
| Browser | `https://askhuman.app/s/{id}` | Human reviewer UI |

## Development

```bash
pnpm install
pnpm run dev:vinext    # local dev server on port 15032
pnpm exec playwright test  # run tests
pnpm run deploy        # deploy to Cloudflare Workers
```

Requires: Node.js, pnpm, wrangler (Cloudflare CLI).

## Architecture

- **Runtime:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Framework:** vinext (Vite-based Next.js for Cloudflare)
- **Real-time:** WebSocket (hibernation API) for browser updates

One Durable Object:
- `SessionDO` — stores plans/diffs, threads, messages, and review views (SQLite). Handles WebSocket for browser clients and long-polling for curl-based agents.

## Security Model

Sessions are identified by short URL-safe random IDs. There is no authentication — the session ID is the sole access control. This is intentional for frictionless agent usage. Don't use this for sensitive content on a shared instance without understanding this tradeoff.

## License

MIT
