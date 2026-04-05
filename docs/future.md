# Future Ideas

## End-to-end encryption

Zero-knowledge plan review where the server only sees ciphertext.

**Trust model:** Agent encrypts with openssl (a tool the user already trusts). The decryption key is placed in the URL fragment (`#key=...`) which never reaches the server. The browser reads it from `window.location.hash` and decrypts with Web Crypto API (same AES-256-GCM).

**Agent side (openssl):**
```bash
KEY=$(openssl rand -base64 32)
openssl enc -aes-256-gcm -in plan.md | curl --data-binary @- https://askhuman.app/plan
# reviewer URL: https://askhuman.app/session/uuid#key=$KEY
```

**The hard part:** Comments and replies also need encryption/decryption. The agent would need to:
1. Poll for comments (JSON with encrypted fields)
2. Extract and decrypt each comment with openssl
3. Encrypt replies with openssl
4. Wrap back into JSON and POST

This is awkward with pure openssl — it doesn't speak JSON. Options:
- A thin shell script that glues jq + openssl + curl together
- A sandboxed Deno script: `deno run --allow-net=askhuman.app https://askhuman.app/cli.ts`
- Ship a small binary in the plugin

The Deno approach is cleanest but has a trust problem — the script is served from the same server that's supposed to be untrusted. The openssl approach is trustworthy but clunky. A compiled binary could be auditable + trusted but adds install friction.

**Server changes:** Minimal. The server already just stores and relays opaque text. Only change: return encrypted blobs instead of plaintext in the API responses, and pass the key fragment through the review URL.

**Browser changes:** Decrypt plan on load using key from hash. Encrypt comments before POST. Decrypt agent replies on WS receive. All using `crypto.subtle` with the same AES-256-GCM parameters as openssl.

**Worth doing when:** Users are reviewing sensitive plans (security audits, proprietary architecture) and need to use a shared/untrusted server.
