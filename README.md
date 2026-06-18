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

The root response tells the agent to generate a self-contained HTML file, encrypt it locally with OpenSSL, upload only ciphertext to `/upload`, and append the local key as a `#k=...` URL fragment before sharing the link. The encrypted payload may include an optional `title` for the viewer tab and optional `filename` for display.

## Security Model

- The server stores `{ version, alg, title?, filename?, iv, ciphertext, mac }`.
- Optional `title` and `filename` metadata are visible to the server; keep them generic if sensitive.
- The key is 64 random bytes encoded as 86 unpadded base64url characters.
- The key lives only in the URL fragment, so it is not sent to the server.
- The browser verifies HMAC-SHA256, decrypts with AES-256-CBC, and renders the HTML in a sandboxed iframe.
- Links expire after 7 days.

## Development

```bash
pnpm install
pnpm run dev:vinext    # local dev server on port 15032
pnpm exec playwright test
pnpm run test:unit
pnpm run deploy
```

## Runtime

- **Framework:** vinext / Next.js on Cloudflare Workers
- **Storage:** Cloudflare KV for encrypted payloads
- **Public endpoints:** `GET /`, `POST /upload`, `GET /s/{id}`, `GET /llms.txt`

## License

MIT
