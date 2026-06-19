/**
 * Generate committed agent-facing docs.
 *
 * Run: node scripts/generate-docs.ts
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function rootPlain(baseUrl: string): string {
  return `# askhuman.app

Create one shareable, end-to-end encrypted link from an agent-generated HTML file.

The human should be able to say:

  curl askhuman.app and use that to create a shareable link from the HTML file

Agent flow:

1. Generate exactly one self-contained HTML file.
2. Compress the HTML file with gzip before encrypting it locally. Never send plaintext or the key to askhuman.app.
3. POST only encrypted multipart form fields to ${baseUrl}/upload.
4. Append the local key as #k=... before sharing the URL with the human.
   The fragment key is 64 random bytes encoded as 86 base64url characters.

Required multipart form fields:

  version=1
  alg=aes-256-cbc+hmac-sha256
  compression=gzip
  iv=<base64url IV>
  ciphertext=<base64url ciphertext>
  mac=<base64url HMAC>

Optional multipart form fields:

  title=<browser/link-preview title>
  filename=<display filename>

Upload limits:

- Request body: 15 MiB max multipart form; ciphertext field: 10 MiB max decoded bytes.
- Uploads are abuse-limited per client. If /upload returns 429, retry later.

HTML expectations:

- Single HTML file: inline app-specific CSS, JS, data, and private assets.
- External JS/CSS/fonts may use only the viewer allowlist: jsDelivr, unpkg, cdnjs, esm.sh, Skypack, JSPM, Google AJAX CDN, jQuery CDN, Tailwind CDN, Google Fonts, and Google Charts.
- Google Charts may be loaded from https://www.gstatic.com/charts/loader.js.
- Google Fonts may use stylesheets from https://fonts.googleapis.com and font files from https://fonts.gstatic.com.
- Make it useful on first load with sensible defaults and a clear title.
- If the page is interactive, every control should update the visible preview immediately.
- For broad option spaces, include 3-5 named presets.
- Design for a sandboxed iframe using the full viewport; keep primary controls and output visible without awkward scrolling.
- Copy buttons are allowed. All other network access is blocked, so keep app data self-contained.

OpenSSL + curl recipe:

  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

  HTML_FILE="page.html"
  TITLE="Agent generated page"
  FILENAME="$(basename "$HTML_FILE")"
  WORKDIR="$(mktemp -d)"
  KEY_BIN="$WORKDIR/key.bin"
  IV_BIN="$WORKDIR/iv.bin"
  PLAINTEXT_BIN="$WORKDIR/html.gz"
  CIPHERTEXT_BIN="$WORKDIR/ciphertext.bin"
  MAC_BIN="$WORKDIR/mac.bin"
  IV_B64_FILE="$WORKDIR/iv.b64"
  CIPHERTEXT_B64_FILE="$WORKDIR/ciphertext.b64"
  MAC_B64_FILE="$WORKDIR/mac.b64"
  RESPONSE_FILE="$WORKDIR/upload-response.txt"

  openssl rand 64 > "$KEY_BIN"
  KEY_B64="$(b64url < "$KEY_BIN")"
  KEY_MATERIAL_HEX="$(od -An -tx1 -v "$KEY_BIN" | tr -d ' \\n')"
  AES_KEY="$(printf '%s' "$KEY_MATERIAL_HEX" | cut -c1-64)"
  MAC_KEY="$(printf '%s' "$KEY_MATERIAL_HEX" | cut -c65-128)"

  openssl rand 16 > "$IV_BIN"
  IV_HEX="$(od -An -tx1 -v "$IV_BIN" | tr -d ' \\n')"
  gzip -n -c "$HTML_FILE" > "$PLAINTEXT_BIN"
  openssl enc -aes-256-cbc -K "$AES_KEY" -iv "$IV_HEX" -nosalt \\
    -in "$PLAINTEXT_BIN" -out "$CIPHERTEXT_BIN"
  cat "$IV_BIN" "$CIPHERTEXT_BIN" | \\
    openssl dgst -sha256 -mac HMAC -macopt "hexkey:$MAC_KEY" -binary > "$MAC_BIN"

  b64url < "$IV_BIN" > "$IV_B64_FILE"
  b64url < "$CIPHERTEXT_BIN" > "$CIPHERTEXT_B64_FILE"
  b64url < "$MAC_BIN" > "$MAC_B64_FILE"

  if ! HTTP_STATUS="$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" -X POST ${baseUrl}/upload \\
    --form-string "version=1" \\
    --form-string "alg=aes-256-cbc+hmac-sha256" \\
    --form-string "compression=gzip" \\
    --form-string "title=$TITLE" \\
    --form-string "filename=$FILENAME" \\
    -F "iv=<$IV_B64_FILE" \\
    -F "ciphertext=<$CIPHERTEXT_B64_FILE" \\
    -F "mac=<$MAC_B64_FILE")"; then
    printf 'Upload request failed.\\n' >&2
    exit 1
  fi
  URL="$(cat "$RESPONSE_FILE")"
  case "$HTTP_STATUS" in
    2*) ;;
    *) printf 'Upload failed (%s): %s\\n' "$HTTP_STATUS" "$URL" >&2; exit 1 ;;
  esac

  printf '%s#k=%s\\n' "$URL" "$KEY_B64"

Give the final printed URL to the human. The #k= fragment is not sent to the server.
Optional title and filename metadata are visible to the server; keep them generic if sensitive.
Links expire after 7 days without access; each access renews the encrypted payload for another 7 days.
`;
}

const llmsTxt = rootPlain("https://askhuman.app");

writeFileSync(resolve(ROOT, "public/llms.txt"), llmsTxt.endsWith("\n") ? llmsTxt : `${llmsTxt}\n`);
console.log("wrote public/llms.txt");

const skillMd = `---
name: askhuman
description: Use when an agent needs to share generated single-file HTML with a human as an end-to-end encrypted askhuman.app link, including requests for a shareable HTML link, human preview, encrypted HTML upload, or askhuman.app.
---

# askhuman.app

Use askhuman.app when a human needs to open an HTML page generated by the agent. Treat \`https://askhuman.app\` as the canonical live protocol.

## Workflow

1. Generate exactly one self-contained HTML file.
2. Run \`curl -s https://askhuman.app\`.
3. Follow the returned instructions exactly.
4. Give the human the final URL, including the \`#k=...\` fragment.

## Rules

- Never upload plaintext HTML.
- Never send the key to the server.
- The key must remain in the URL fragment.
- Compress the HTML file with gzip before encrypting it.
- Do not invent upload formats, cryptography, endpoints, or parameters; use the current curl response.
- Make the HTML useful on first load. Keep app data self-contained; external resources must stay within the askhuman viewer allowlist.
- If \`/upload\` returns 429, retry later.
`;

writeFileSync(resolve(ROOT, "skills/askhuman/SKILL.md"), skillMd);
console.log("wrote skills/askhuman/SKILL.md");
