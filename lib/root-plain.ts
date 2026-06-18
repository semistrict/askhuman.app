export function buildRootPlainText(baseUrl: string): string {
  return `# askhuman.app

Create one shareable, end-to-end encrypted link from an agent-generated HTML file.

The human should be able to say:

  curl askhuman.app and use that to create a shareable link from the HTML file

Agent flow:

1. Generate exactly one self-contained HTML file.
2. Compress it with gzip, then encrypt it locally. Never send plaintext or the key to askhuman.app.
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
- Per Cloudflare-detected client IP: 20 upload attempts per minute.
- Per Cloudflare-detected client IP: 100 successful uploads and 100 MiB uploaded per day.
- If /upload returns 429, wait for the Retry-After seconds before trying again.

HTML expectations:

- Single file: inline all CSS and JS. Do not depend on CDNs, remote fonts, or external APIs.
- Make it useful on first load with sensible defaults and a clear title.
- If the page is interactive, every control should update the visible preview immediately.
- For broad option spaces, include 3-5 named presets.
- Design for a sandboxed iframe using the full viewport; keep primary controls and output visible without awkward scrolling.
- Copy buttons are allowed, but network access is blocked, so keep assets and data self-contained.

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

  URL="$(curl -s -X POST ${baseUrl}/upload \\
    --form-string "version=1" \\
    --form-string "alg=aes-256-cbc+hmac-sha256" \\
    --form-string "compression=gzip" \\
    --form-string "title=$TITLE" \\
    --form-string "filename=$FILENAME" \\
    -F "iv=<$IV_B64_FILE" \\
    -F "ciphertext=<$CIPHERTEXT_B64_FILE" \\
    -F "mac=<$MAC_B64_FILE")"

  printf '%s#k=%s\\n' "$URL" "$KEY_B64"

Give the final printed URL to the human. The #k= fragment is not sent to the server.
Optional title and filename metadata are visible to the server; keep them generic if sensitive.
Links expire after 7 days.
`;
}
