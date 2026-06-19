export type RootPlainRecipe = "openssl" | "powershell";

export function detectRootPlainRecipe(request: Request): RootPlainRecipe {
  const userAgent = request.headers.get("user-agent") || "";
  const platformOverride = request.headers.get("x-askhuman-platform") || "";
  const values = [
    userAgent,
    request.headers.get("sec-ch-ua-platform") || "",
    platformOverride,
  ].join(" ");

  if (/\bwindows\b/i.test(platformOverride)) return "powershell";
  if (/\b(windowspowershell|powershell|pwsh|winhttp|wininet)\b/i.test(values)) {
    return "powershell";
  }
  if (/^curl\//i.test(userAgent) && /\bwindows\b/i.test(values)) {
    return "powershell";
  }

  return "openssl";
}

function buildOpenSslRecipe(baseUrl: string): string {
  return `OpenSSL + curl recipe:

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

  printf '%s#k=%s\\n' "$URL" "$KEY_B64"`;
}

function buildPowerShellRecipe(baseUrl: string): string {
  return `PowerShell + .NET recipe for Windows:

  Add-Type -AssemblyName System.Net.Http
  $BaseUrl = "${baseUrl}"
  $HtmlFile = "page.html"
  $Title = "Agent generated page"
  $Filename = [IO.Path]::GetFileName($HtmlFile)

  function ConvertTo-Base64Url([byte[]] $Bytes) {
    [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  }

  $Key = New-Object byte[] 64
  $AesKey = New-Object byte[] 32
  $MacKey = New-Object byte[] 32
  $Iv = New-Object byte[] 16
  $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $Rng.GetBytes($Key)
  $Rng.GetBytes($Iv)
  [Buffer]::BlockCopy($Key, 0, $AesKey, 0, 32)
  [Buffer]::BlockCopy($Key, 32, $MacKey, 0, 32)

  $HtmlBytes = [IO.File]::ReadAllBytes((Resolve-Path $HtmlFile))
  $CompressedStream = [IO.MemoryStream]::new()
  $Gzip = [IO.Compression.GZipStream]::new(
    $CompressedStream,
    [IO.Compression.CompressionLevel]::Optimal,
    $true
  )
  $Gzip.Write($HtmlBytes, 0, $HtmlBytes.Length)
  $Gzip.Dispose()
  $Plaintext = $CompressedStream.ToArray()
  $CompressedStream.Dispose()

  $Aes = [Security.Cryptography.Aes]::Create()
  $Aes.Mode = [Security.Cryptography.CipherMode]::CBC
  $Aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
  $Aes.KeySize = 256
  $Aes.Key = $AesKey
  $Aes.IV = $Iv
  $Encryptor = $Aes.CreateEncryptor()
  $Ciphertext = $Encryptor.TransformFinalBlock($Plaintext, 0, $Plaintext.Length)
  $Encryptor.Dispose()
  $Aes.Dispose()

  $MacInput = New-Object byte[] ($Iv.Length + $Ciphertext.Length)
  [Buffer]::BlockCopy($Iv, 0, $MacInput, 0, $Iv.Length)
  [Buffer]::BlockCopy($Ciphertext, 0, $MacInput, $Iv.Length, $Ciphertext.Length)
  $Hmac = [Security.Cryptography.HMACSHA256]::new($MacKey)
  $Mac = $Hmac.ComputeHash($MacInput)
  $Hmac.Dispose()
  $Rng.Dispose()

  $Form = [System.Net.Http.MultipartFormDataContent]::new()
  function Add-Field([string] $Name, [string] $Value) {
    $Content = [System.Net.Http.StringContent]::new($Value, [System.Text.Encoding]::UTF8)
    $Form.Add($Content, $Name)
  }

  Add-Field "version" "1"
  Add-Field "alg" "aes-256-cbc+hmac-sha256"
  Add-Field "compression" "gzip"
  Add-Field "title" $Title
  Add-Field "filename" $Filename
  Add-Field "iv" (ConvertTo-Base64Url $Iv)
  Add-Field "ciphertext" (ConvertTo-Base64Url $Ciphertext)
  Add-Field "mac" (ConvertTo-Base64Url $Mac)

  $Client = [System.Net.Http.HttpClient]::new()
  try {
    $Response = $Client.PostAsync("$BaseUrl/upload", $Form).GetAwaiter().GetResult()
    $Url = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult().Trim()
    if (-not $Response.IsSuccessStatusCode) {
      throw "Upload failed ($([int] $Response.StatusCode)): $Url"
    }
    "{0}#k={1}" -f $Url, (ConvertTo-Base64Url $Key)
  } finally {
    $Client.Dispose()
    $Form.Dispose()
  }`;
}

export function buildRootPlainText(
  baseUrl: string,
  options: { recipe?: RootPlainRecipe } = {}
): string {
  const recipe = options.recipe ?? "openssl";
  const recipeText = recipe === "powershell" ? buildPowerShellRecipe(baseUrl) : buildOpenSslRecipe(baseUrl);

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

${recipeText}

Give the final printed URL to the human. The #k= fragment is not sent to the server.
Optional title and filename metadata are visible to the server; keep them generic if sensitive.
Links expire after 7 days without access; each access renews the encrypted payload for another 7 days.
`;
}
