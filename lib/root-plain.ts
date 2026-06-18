export function buildRootPlainText(baseUrl: string): string {
  return `# askhuman.app

Create one shareable, end-to-end encrypted link from an agent-generated HTML file.

The human should be able to say:

  curl askhuman.app and use that to create a shareable link from the HTML file

Agent flow:

1. Generate exactly one self-contained HTML file.
2. Encrypt it locally. Never send plaintext or the key to askhuman.app.
3. POST only encrypted JSON to ${baseUrl}/upload.
4. Append the local key as #k=... before sharing the URL with the human.
   The fragment key is 64 random bytes encoded as 86 base64url characters.

Required payload:

  {"version":1,"alg":"aes-256-cbc+hmac-sha256","iv":"...","ciphertext":"...","mac":"..."}

OpenSSL + curl recipe:

  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

  HTML_FILE="page.html"
  WORKDIR="$(mktemp -d)"
  KEY_BIN="$WORKDIR/key.bin"
  IV_BIN="$WORKDIR/iv.bin"
  CIPHERTEXT_BIN="$WORKDIR/ciphertext.bin"
  MAC_BIN="$WORKDIR/mac.bin"
  PAYLOAD_JSON="$WORKDIR/encrypted-html.json"

  openssl rand 64 > "$KEY_BIN"
  KEY_B64="$(b64url < "$KEY_BIN")"
  KEY_MATERIAL_HEX="$(od -An -tx1 -v "$KEY_BIN" | tr -d ' \\n')"
  AES_KEY="$(printf '%s' "$KEY_MATERIAL_HEX" | cut -c1-64)"
  MAC_KEY="$(printf '%s' "$KEY_MATERIAL_HEX" | cut -c65-128)"

  openssl rand 16 > "$IV_BIN"
  IV_HEX="$(od -An -tx1 -v "$IV_BIN" | tr -d ' \\n')"
  openssl enc -aes-256-cbc -K "$AES_KEY" -iv "$IV_HEX" -nosalt \\
    -in "$HTML_FILE" -out "$CIPHERTEXT_BIN"
  cat "$IV_BIN" "$CIPHERTEXT_BIN" | \\
    openssl dgst -sha256 -mac HMAC -macopt "hexkey:$MAC_KEY" -binary > "$MAC_BIN"

  IV_B64="$(b64url < "$IV_BIN")"
  CIPHERTEXT_B64="$(b64url < "$CIPHERTEXT_BIN")"
  MAC_B64="$(b64url < "$MAC_BIN")"

  printf '{"version":1,"alg":"aes-256-cbc+hmac-sha256","iv":"%s","ciphertext":"%s","mac":"%s"}\\n' \\
    "$IV_B64" "$CIPHERTEXT_B64" "$MAC_B64" > "$PAYLOAD_JSON"

  URL="$(curl -s -X POST ${baseUrl}/upload \\
    -H "Content-Type: application/json" \\
    --data-binary "@$PAYLOAD_JSON")"

  printf '%s#k=%s\\n' "$URL" "$KEY_B64"

Give the final printed URL to the human. The #k= fragment is not sent to the server.
Links expire after 7 days.
`;
}
