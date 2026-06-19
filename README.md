# askhuman.app

Share one agent-generated HTML file with a human, end-to-end encrypted.

The normal prompt is:

```text
curl askhuman.app and use that to create a shareable link from the HTML file
```

The agent runs:

```bash
curl -s https://askhuman.app
```

The root response tells the agent to generate a self-contained HTML file, compress it with gzip, encrypt it locally with OpenSSL, upload only ciphertext multipart form fields to `/upload`, and append the local key as a `#k=...` URL fragment before sharing the link. The encrypted upload may include an optional `title` for the viewer tab and optional `filename` for display.

## Security Model

- The server stores encrypted upload fields `{ version, alg, compression?, title?, filename?, iv, ciphertext, mac }`.
- Optional `title` and `filename` metadata are visible to the server; keep them generic if sensitive.
- The key is 64 random bytes encoded as 86 unpadded base64url characters.
- The key lives only in the URL fragment, so it is not sent to the server.
- The browser verifies HMAC-SHA256, decrypts with AES-256-CBC, decompresses gzip payloads, and renders the HTML in a sandboxed iframe.
- The iframe allows inline code plus a curated external-resource allowlist for common JS CDNs, Google Fonts, and Google Charts; other network access remains blocked.
- Uploads are capped at 15 MiB per multipart request and 10 MiB decoded ciphertext.
- Uploads are abuse-limited per client.
- Links expire after 7 days without access; each access renews the encrypted payload for another 7 days.

## Development

```bash
pnpm install
pnpm run dev    # local dev server on port 15032
pnpm exec playwright test
pnpm run test:unit
pnpm run deploy
```

## Runtime

- **Framework:** TanStack Start on Cloudflare Workers
- **Storage:** Cloudflare KV for encrypted payloads and hashed per-client upload quota counters
- **Abuse guardrails:** Cloudflare Rate Limiting binding plus KV daily upload quotas
- **Public endpoints:** `GET /`, `POST /upload`, `GET /s/{id}`, `GET /llms.txt`

## Agent Skill

The repo-local, agent-neutral skill lives at `skills/askhuman/SKILL.md`.

## License

MIT
