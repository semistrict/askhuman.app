# askhuman.app

Human-in-the-loop review tools for AI agents. Sometimes your agent needs to phone a friend.

Agents submit plans, diffs, files, or playgrounds via curl. Humans review in their browser with general or line-specific comments, then click Done. Agents poll for the completed review and update the session as needed.

**Live at [askhuman.app](https://askhuman.app)**

## Quick Start

**Any agent (zero install):**
```
curl https://askhuman.app
```

## How It Works

1. Agent submits a plan, diff, file set, or playground
2. Human reviews in the browser and leaves comments
3. Human clicks Done when the review is ready
4. Agent polls for the completed review
5. Agent updates the session or starts a fresh review when needed

## Interfaces

| Interface | Endpoint | Use |
|-----------|----------|-----|
| REST | `https://askhuman.app/{plan,diff,files,playground}` | curl, fetch, any HTTP client |
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
- `SessionDO` — stores session content, comments, and review state (SQLite). Handles WebSocket for browser clients and long-polling for curl-based agents.

## Security Model

Sessions are identified by short URL-safe random IDs. There is no authentication — the session ID is the sole access control. This is intentional for frictionless agent usage. Don't use this for sensitive content on a shared instance without understanding this tradeoff.

## License

MIT
