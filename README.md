# askhuman.app

Human-in-the-loop review tools for AI agents. Sometimes your agent needs to phone a friend.

Agents first start a tool-specific session via curl, then ask the human to open the review URL, then submit the actual tool payload into that session. Single-markdown-file reviews return when the reviewer clicks `Request Revision`; diff, presentation, multi-file, playground, and encrypted-share sessions return when the reviewer clicks `Done`.

**Live at [askhuman.app](https://askhuman.app)**

## Quick Start

**Any agent (zero install):**
```
curl https://askhuman.app
```

## How It Works

1. Agent starts a tool-specific session
2. Human opens the session URL in the browser
3. Agent submits the tool payload into that session
4. The submit call waits for the human and returns the completed review
5. Agent updates the same session or starts a fresh one when needed

## Interfaces

| Interface | Endpoint | Use |
|-----------|----------|-----|
| REST bootstrap | `https://askhuman.app/{review,diff,present,playground,share}` | create a tool-specific session |
| REST action | `https://askhuman.app/{review,diff,present,playground,share}/{id}` | submit or update tool content inside a session |
| REST poll | `https://askhuman.app/{review,diff,present,playground,share}/{id}/poll` | optional standalone poll when no other agent waiter is active |
| Browser | `https://askhuman.app/s/{id}` | Human reviewer UI |

Compatibility aliases:
- `/files` still works for the review flow
- `/plan` still works for single markdown-file review sessions
- `/remark` still works for presentations

## End-to-End Encryption

`/review`, `/diff`, `/present`, and `/playground` now support optional end-to-end encryption. When the reviewer opens the session page, they can either enable localStorage-backed browser keys and copy encrypted submission instructions back to the agent, or explicitly continue with the normal plaintext flow.

`/share` remains a dedicated end-to-end encrypted document handoff: the reviewer browser stores a private key in localStorage, uploads only a 24-hour public-key reference, and the agent uploads only ciphertext JSON. The server never receives the private key or plaintext.

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
